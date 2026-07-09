# Bridge-only Daytona image.
# ponytail: tiny package set; keep systemd masking because boot contracts are not optional.

FROM ubuntu:24.04

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

ENV SPANNER_DAYTONA_IMAGE=1

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl git gh jq sudo openssh-client openssh-server \
      systemd systemd-sysv dbus-user-session && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    rm -f /usr/sbin/policy-rc.d /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub

RUN rm -f /etc/systemd/system/multi-user.target.wants/console-setup.service \
          /etc/systemd/system/multi-user.target.wants/ModemManager.service \
          /etc/systemd/system/multi-user.target.wants/snapd.* \
          /etc/systemd/system/multi-user.target.wants/unattended-upgrades.* \
          /etc/systemd/system/multi-user.target.wants/ubuntu-advantage.service && \
    systemctl mask -- \
      getty.target fwupd.service fwupd-refresh.service fwupd-refresh.timer \
      systemd-random-seed.service iscsid.socket dm-event.socket man-db.timer \
      update-notifier-download.timer update-notifier-motd.timer \
      dpkg-db-backup.timer e2scrub_all.timer \
      etc-resolv.conf.mount etc-hosts.mount etc-hostname.mount -.mount \
      systemd-resolved.service systemd-remount-fs.service \
      systemd-sysusers.service systemd-update-done.service \
      systemd-update-utmp.service systemd-journal-catalog-update.service \
      modprobe@.service systemd-modules-load.service \
      systemd-udevd.service systemd-udevd-control.service \
      systemd-udevd-kernel.service systemd-udev-trigger.service \
      systemd-udev-settle.service systemd-hwdb-update.service \
      ldconfig.service unattended-upgrades.service lxd-installer.socket \
      console-getty.service keyboard-setup.service \
      systemd-ask-password-console.path systemd-ask-password-wall.path \
      plymouth.service plymouth-start.service plymouth-quit.service \
      plymouth-quit-wait.service plymouth-read-write.service \
      plymouth-switch-root.service plymouth-switch-root-initramfs.service \
      plymouth-halt.service plymouth-reboot.service plymouth-poweroff.service \
      plymouth-kexec.service plymouth-log.service \
      apt-daily-upgrade.timer apt-daily.timer && \
    systemctl disable getty.target systemd-logind.service \
      console-getty.service getty@.service snapd.socket \
      motd-news.timer motd-news.service \
      apport.service apport-autoreport.timer apport-autoreport.path apport-forward.socket \
      snapd.snap-repair.timer snapd.snap-repair.service \
      udisks2.service ufw.service lvm2-lvmpolld.socket \
      systemd-ask-password-wall.service systemd-ask-password-console.service \
      systemd-machine-id-commit.service systemd-modules-load.service \
      systemd-sysctl.service systemd-firstboot.service \
      systemd-udevd.service systemd-udev-trigger.service systemd-udev-settle.service \
      e2scrub_reap.service systemd-update-utmp.service systemd-hwdb-update.service \
      multipathd.service 2>/dev/null || true && \
    mkdir -p /etc/systemd/system.conf.d /etc/systemd/journald.conf.d && \
    printf '[Manager]\nLogLevel=info\nLogTarget=console\nSystemCallArchitectures=native\nDefaultOOMPolicy=continue\n' > /etc/systemd/system.conf.d/container-overrides.conf && \
    printf '[Journal]\nStorage=persistent\n' > /etc/systemd/journald.conf.d/persistent.conf && \
    systemctl set-default multi-user.target

RUN usermod -l daytona -c "Daytona user" ubuntu && \
    groupmod -n daytona ubuntu && \
    mv /home/ubuntu /home/daytona && \
    usermod -d /home/daytona -aG sudo daytona && \
    sed -i 's/^ubuntu:/daytona:/' /etc/subuid /etc/subgid && \
    printf 'daytona ALL=(ALL) NOPASSWD:ALL\nDefaults:daytona verifypw=any\n' >/etc/sudoers.d/daytona && \
    chmod 0440 /etc/sudoers.d/daytona && \
    mkdir -p /home/daytona/.local/bin /home/daytona/.pi/agent/npm /var/lib/systemd/linger && \
    touch /var/lib/systemd/linger/daytona && \
    echo '/dev/vda / ext4 defaults,x-systemd.growfs 0 1' > /etc/fstab

COPY package.json /home/daytona/.pi/agent/npm/package.json
COPY ctx/ /tmp/spanner-ctx/

RUN npm install --prefix /home/daytona/.pi/agent/npm --no-audit --no-fund --omit=dev --ignore-scripts --legacy-peer-deps && \
    if [ -d /tmp/spanner-ctx/spanner-pi-defaults ]; then \
      rm -rf /home/daytona/.pi/agent/spanner-pi-defaults && \
      cp -R /tmp/spanner-ctx/spanner-pi-defaults /home/daytona/.pi/agent/spanner-pi-defaults; \
    fi && \
    ln -sf /home/daytona/.pi/agent/npm/node_modules/.bin/pi /home/daytona/.local/bin/pi && \
    ln -sf /home/daytona/.local/bin/pi /usr/local/bin/pi && \
    if [ -d /home/daytona/.pi/agent/spanner-pi-defaults ]; then \
      settings='{"defaultProvider":"openai-codex","defaultModel":"gpt-5.4","defaultThinkingLevel":"medium","enabledModels":["openai-codex/gpt-5.4","openai-codex/gpt-5.4-mini","inference/nvidia/nemotron3-super"],"packages":["/home/daytona/.pi/agent/spanner-pi-defaults","npm:pi-chrome"]}'; \
    else \
      settings='{"defaultProvider":"openai-codex","defaultModel":"gpt-5.4","defaultThinkingLevel":"medium","enabledModels":["openai-codex/gpt-5.4","openai-codex/gpt-5.4-mini"],"packages":["npm:pi-chrome"]}'; \
    fi && \
    printf '%s\n' "$settings" > /home/daytona/.pi/agent/settings.json && \
    chown -R daytona:daytona /home/daytona

COPY init-wrapper.sh /usr/local/bin/init
RUN chmod 0755 /usr/local/bin/init && \
    systemctl enable ssh.service

USER daytona
WORKDIR /home/daytona
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/daytona/.profile && \
    echo 'export XDG_RUNTIME_DIR="/run/user/$(id -u)"' >> /home/daytona/.profile && \
    git config --global init.defaultBranch main && \
    touch /home/daytona/.hushlogin
USER root

LABEL "dev.daytona.user"="daytona"
CMD ["/usr/local/bin/init"]
