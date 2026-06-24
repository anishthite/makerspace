#!/bin/bash
# Wraps systemd init with the precursor commands containerized systemd needs.

echo "Docker users can use Ctrl-P Ctrl-Q to detach."

if [[ $$ != 1 ]]; then
    echo "Must be run as pid 1 for systemd to start."
    exit 1
fi

mkdir -p /run/systemd
if [[ ! -f /sys/fs/cgroup/cgroup.controllers ]]; then
    mount -t cgroup2 none /sys/fs/cgroup
fi

if [[ -w /proc/sys/net/ipv4/ip_unprivileged_port_start ]]; then
    printf '0\n' >/proc/sys/net/ipv4/ip_unprivileged_port_start
fi
if [[ -w /proc/sys/net/ipv6/ip_unprivileged_port_start ]]; then
    printf '0\n' >/proc/sys/net/ipv6/ip_unprivileged_port_start
fi

mount -o remount,rw /proc/sys

# ponytail: host keys are deleted at build time; generate per sandbox at boot.
ssh-keygen -A
mkdir -p /run/sshd

echo "Starting systemd..."
exec /sbin/init --log-target=syslog --show-status=true
