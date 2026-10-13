package codexauth

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAuthBaseURL = "https://auth.openai.com"
	clientID           = "app_EMoamEEZ73f0CkXaXp7hrann"
	verificationURL    = defaultAuthBaseURL + "/codex/device"
	deviceRedirectURL  = defaultAuthBaseURL + "/deviceauth/callback"
)

type Credentials struct {
	Access    string `json:"access"`
	Refresh   string `json:"refresh"`
	ExpiresAt int64  `json:"expires_at"`
	AccountID string `json:"account_id"`
}

type Config struct {
	AuthBaseURL    string
	CredentialPath string
	HTTP           *http.Client
}

type deviceCode struct {
	DeviceAuthID string
	UserCode     string
	Interval     time.Duration
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

func Login(ctx context.Context, out io.Writer, config Config) error {
	base := strings.TrimRight(config.AuthBaseURL, "/")
	if base == "" {
		base = defaultAuthBaseURL
	}
	client := config.HTTP
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	device, err := requestDeviceCode(ctx, client, base)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "Open %s and enter code %s. This code expires in 15 minutes.\n", verificationURLFor(base), device.UserCode)
	fmt.Fprintln(out, "Continue only if you started this login in Spanner.")
	code, verifier, err := poll(ctx, client, base, device)
	if err != nil {
		return err
	}
	tokens, err := exchange(ctx, client, base, code, verifier)
	if err != nil {
		return err
	}
	accountID, err := accountID(tokens.AccessToken)
	if err != nil {
		return err
	}
	path, err := credentialPath(config.CredentialPath)
	if err != nil {
		return err
	}
	credentials := Credentials{Access: tokens.AccessToken, Refresh: tokens.RefreshToken, ExpiresAt: time.Now().Add(time.Duration(tokens.ExpiresIn) * time.Second).Unix(), AccountID: accountID}
	if err := save(path, credentials); err != nil {
		return err
	}
	fmt.Fprintf(out, "Signed in. Credentials saved to %s.\n", path)
	return nil
}

func requestDeviceCode(ctx context.Context, client *http.Client, base string) (deviceCode, error) {
	var response struct {
		DeviceAuthID string          `json:"device_auth_id"`
		UserCode     string          `json:"user_code"`
		Interval     json.RawMessage `json:"interval"`
	}
	if err := postJSON(ctx, client, base+"/api/accounts/deviceauth/usercode", map[string]string{"client_id": clientID}, &response); err != nil {
		return deviceCode{}, fmt.Errorf("request Codex device code: %w", err)
	}
	interval := 5
	if len(response.Interval) != 0 {
		value := string(response.Interval)
		if strings.HasPrefix(value, "\"") {
			if err := json.Unmarshal(response.Interval, &value); err != nil {
				return deviceCode{}, fmt.Errorf("invalid Codex polling interval")
			}
		}
		var err error
		interval, err = strconv.Atoi(strings.TrimSpace(value))
		if err != nil || interval < 0 || interval > 900 {
			return deviceCode{}, fmt.Errorf("invalid Codex polling interval")
		}
	}
	if response.DeviceAuthID == "" || response.UserCode == "" {
		return deviceCode{}, fmt.Errorf("invalid Codex device code response")
	}
	if interval < 1 {
		interval = 1
	}
	return deviceCode{DeviceAuthID: response.DeviceAuthID, UserCode: response.UserCode, Interval: time.Duration(interval) * time.Second}, nil
}

func poll(ctx context.Context, client *http.Client, base string, device deviceCode) (string, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	for {
		var response struct {
			AuthorizationCode string `json:"authorization_code"`
			CodeVerifier      string `json:"code_verifier"`
		}
		err := postJSON(ctx, client, base+"/api/accounts/deviceauth/token", map[string]string{"device_auth_id": device.DeviceAuthID, "user_code": device.UserCode}, &response)
		if err == nil {
			if response.AuthorizationCode == "" || response.CodeVerifier == "" {
				return "", "", fmt.Errorf("invalid Codex device authorization response")
			}
			return response.AuthorizationCode, response.CodeVerifier, nil
		}
		var status *httpError
		if !errors.As(err, &status) {
			return "", "", fmt.Errorf("poll Codex device authorization: %w", err)
		}
		if status.Code == "slow_down" {
			device.Interval += 5 * time.Second
		} else if status.Code != "deviceauth_authorization_pending" && status.Status != http.StatusForbidden && status.Status != http.StatusNotFound {
			return "", "", fmt.Errorf("poll Codex device authorization: %w", err)
		}
		timer := time.NewTimer(device.Interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", "", ctx.Err()
		case <-timer.C:
		}
	}
}

func exchange(ctx context.Context, client *http.Client, base, code, verifier string) (tokenResponse, error) {
	form := url.Values{"grant_type": {"authorization_code"}, "client_id": {clientID}, "code": {code}, "code_verifier": {verifier}, "redirect_uri": {deviceRedirectURL}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var tokens tokenResponse
	if err := doJSON(client, req, &tokens); err != nil {
		return tokenResponse{}, fmt.Errorf("exchange Codex authorization code: %w", err)
	}
	if tokens.AccessToken == "" || tokens.RefreshToken == "" || tokens.ExpiresIn <= 0 {
		return tokenResponse{}, fmt.Errorf("invalid Codex token response")
	}
	return tokens, nil
}

func postJSON(ctx context.Context, client *http.Client, endpoint string, input, output any) error {
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return doJSON(client, req, output)
}

type httpError struct {
	Status int
	Code   string
}

// Never echo OAuth response bodies: they can contain credentials or device codes.
func (e *httpError) Error() string { return fmt.Sprintf("HTTP %d", e.Status) }

func doJSON(client *http.Client, req *http.Request, output any) error {
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
		var payload struct {
			Error json.RawMessage `json:"error"`
		}
		var code string
		if json.Unmarshal(body, &payload) == nil {
			if json.Unmarshal(payload.Error, &code) != nil {
				var detail struct {
					Code string `json:"code"`
				}
				if json.Unmarshal(payload.Error, &detail) == nil {
					code = detail.Code
				}
			}
		}
		return &httpError{Status: response.StatusCode, Code: code}
	}
	return json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(output)
}

func accountID(access string) (string, error) {
	parts := strings.Split(access, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("Codex access token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode Codex access token: %w", err)
	}
	var claims struct {
		Auth struct {
			AccountID string `json:"chatgpt_account_id"`
		} `json:"https://api.openai.com/auth"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Auth.AccountID == "" {
		return "", fmt.Errorf("Codex access token has no ChatGPT account ID")
	}
	return claims.Auth.AccountID, nil
}

func credentialPath(path string) (string, error) {
	if path != "" {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".spanner", "auth.json"), nil
}

func save(path string, credentials Credentials) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	body, err := json.Marshal(credentials)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".auth-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if err := temp.Chmod(0600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(append(body, '\n')); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func verificationURLFor(base string) string {
	if base == defaultAuthBaseURL {
		return verificationURL
	}
	return base + "/codex/device"
}
