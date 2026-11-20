#!/bin/bash
# One-time base setup for the Oracle Ubuntu 22.04 server. Safe to re-run.
#   scp deploy/server-setup.sh ubuntu@nzmpi.duckdns.org: && ssh ubuntu@nzmpi.duckdns.org 'sudo bash server-setup.sh'
# Also open TCP 80 and 443 (and UDP 443) in the Oracle VCN security list; this script only does the host firewall.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "== OS updates"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq unattended-upgrades docker.io docker-compose-v2
dpkg-reconfigure -fnoninteractive unattended-upgrades

echo "== 2 GB swap"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
    [ -f /swapfile ] || fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

echo "== SSH: keys only"
cat > /etc/ssh/sshd_config.d/10-keys-only.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
CONF
sshd -t # a bad config must not lock us out
systemctl reload ssh

echo "== Host firewall: 22, 80, 443"
# Oracle images ship iptables rules that end INPUT with a REJECT. Insert above it.
reject=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" {print $1; exit}')
for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
    # shellcheck disable=SC2086
    iptables -C INPUT -m state --state NEW $rule -j ACCEPT 2>/dev/null ||
        iptables -I INPUT "${reject:-1}" -m state --state NEW $rule -j ACCEPT
done
netfilter-persistent save

echo "== Docker"
systemctl enable --now docker
[ -n "${SUDO_USER:-}" ] && usermod -aG docker "$SUDO_USER"

echo "done. Log out and back in so '${SUDO_USER:-you}' can run docker without sudo."
