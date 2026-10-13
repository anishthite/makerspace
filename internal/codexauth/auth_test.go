package codexauth

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoginCompletesDeviceFlowAndStoresCredentials(t *testing.T) {
	access := jwt(`{"https://api.openai.com/auth":{"chatgpt_account_id":"acct_123"}}`)
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		switch r.URL.Path {
		case "/api/accounts/deviceauth/usercode":
			fmt.Fprint(w, `{"device_auth_id":"device","user_code":"ABCD-EFGH","interval":"0"}`)
		case "/api/accounts/deviceauth/token":
			fmt.Fprint(w, `{"authorization_code":"code","code_verifier":"verifier"}`)
		case "/oauth/token":
			if err := r.ParseForm(); err != nil || r.Form.Get("code") != "code" || r.Form.Get("code_verifier") != "verifier" || r.Form.Get("redirect_uri") != deviceRedirectURL {
				t.Error("invalid token exchange")
			}
			fmt.Fprintf(w, `{"access_token":%q,"refresh_token":"refresh","expires_in":3600}`, access)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "credentials", "auth.json")
	var output strings.Builder
	if err := Login(context.Background(), &output, Config{AuthBaseURL: server.URL, CredentialPath: path}); err != nil {
		t.Fatal(err)
	}
	if got, want := strings.Join(calls, ","), "/api/accounts/deviceauth/usercode,/api/accounts/deviceauth/token,/oauth/token"; got != want {
		t.Fatalf("calls = %s, want %s", got, want)
	}
	if !strings.Contains(output.String(), "ABCD-EFGH") || strings.Contains(output.String(), "refresh") {
		t.Fatalf("unsafe login output: %q", output.String())
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("mode = %o, want 600", info.Mode().Perm())
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"account_id":"acct_123"`) || !strings.Contains(string(body), `"refresh":"refresh"`) {
		t.Fatalf("unexpected credentials: %s", body)
	}
}

func TestLoginRejectsTokenWithoutAccountID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/accounts/deviceauth/usercode":
			fmt.Fprint(w, `{"device_auth_id":"device","user_code":"code","interval":1}`)
		case "/api/accounts/deviceauth/token":
			fmt.Fprint(w, `{"authorization_code":"code","code_verifier":"verifier"}`)
		case "/oauth/token":
			fmt.Fprint(w, `{"access_token":"header.payload.signature","refresh_token":"refresh","expires_in":3600}`)
		}
	}))
	defer server.Close()
	err := Login(context.Background(), io.Discard, Config{AuthBaseURL: server.URL, CredentialPath: filepath.Join(t.TempDir(), "auth.json")})
	if err == nil || !strings.Contains(err.Error(), "account ID") {
		t.Fatalf("error = %v", err)
	}
}

func jwt(payload string) string {
	return "header." + base64.RawURLEncoding.EncodeToString([]byte(payload)) + ".signature"
}

func TestPollingPendingThenApproved(t *testing.T) {
	for _, pending := range []struct {
		status int
		body   string
	}{
		{403, `{}`}, {404, `{}`}, {400, `{"error":"deviceauth_authorization_pending"}`},
		{400, `{"error":{"code":"deviceauth_authorization_pending"}}`},
	} {
		t.Run(fmt.Sprintf("%d-%s", pending.status, pending.body), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if calls == 1 {
					w.WriteHeader(pending.status)
					fmt.Fprint(w, pending.body)
					return
				}
				fmt.Fprint(w, `{"authorization_code":"approved","code_verifier":"verifier"}`)
			}))
			defer server.Close()
			code, verifier, err := poll(context.Background(), server.Client(), server.URL, deviceCode{DeviceAuthID: "device", UserCode: "code", Interval: time.Millisecond})
			if err != nil || code != "approved" || verifier != "verifier" || calls != 2 {
				t.Fatalf("poll = %q, %q, %v; calls=%d", code, verifier, err, calls)
			}
		})
	}
}

func TestPollingCancellation(t *testing.T) {
	for _, status := range []int{403, 400} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				if status == 400 {
					fmt.Fprint(w, `{"error":"slow_down"}`)
				}
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
			defer cancel()
			_, _, err := poll(ctx, server.Client(), server.URL, deviceCode{Interval: time.Second})
			if err != context.DeadlineExceeded {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestLoginFailuresDoNotOverwriteCredentialsOrLeakSecrets(t *testing.T) {
	for _, stage := range []string{"device", "poll", "exchange"} {
		t.Run(stage, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fail := (stage == "device" && strings.HasSuffix(r.URL.Path, "usercode")) || (stage == "poll" && strings.HasSuffix(r.URL.Path, "deviceauth/token")) || (stage == "exchange" && r.URL.Path == "/oauth/token")
				if fail {
					w.WriteHeader(500)
					fmt.Fprint(w, `{"access_token":"private-secret"}`)
					return
				}
				if strings.HasSuffix(r.URL.Path, "usercode") {
					fmt.Fprint(w, `{"device_auth_id":"device","user_code":"code","interval":1}`)
				} else {
					fmt.Fprint(w, `{"authorization_code":"code","code_verifier":"verifier"}`)
				}
			}))
			defer server.Close()
			path := filepath.Join(t.TempDir(), "auth.json")
			if err := os.WriteFile(path, []byte("existing"), 0600); err != nil {
				t.Fatal(err)
			}
			var output strings.Builder
			err := Login(context.Background(), &output, Config{AuthBaseURL: server.URL, CredentialPath: path})
			if err == nil || strings.Contains(err.Error()+output.String(), "private-secret") {
				t.Fatalf("error = %v; output=%s", err, output.String())
			}
			body, err := os.ReadFile(path)
			if err != nil || string(body) != "existing" {
				t.Fatalf("credentials overwritten: %s, %v", body, err)
			}
		})
	}
}

func TestDeviceIntervalValidation(t *testing.T) {
	for _, interval := range []string{`"bad"`, `null`, `1.5`, `-1`, `901`, `"2 junk"`} {
		t.Run(interval, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, `{"device_auth_id":"id","user_code":"code","interval":%s}`, interval)
			}))
			defer server.Close()
			_, err := requestDeviceCode(context.Background(), server.Client(), server.URL)
			if err == nil {
				t.Fatal("accepted invalid interval")
			}
		})
	}
}
