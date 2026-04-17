#cloud-config

autoinstall:
  version: 1
  apt:
    geoip: true
    preserve_sources_list: false
    primary:
      - arches: [amd64, i386]
        uri: http://archive.ubuntu.com/ubuntu
      - arches: [default]
        uri: http://ports.ubuntu.com/ubuntu-ports
    preferences:
      - package: linux-firmware
        pin: "release *"
        pin-priority: -1
  early-commands:
    - sudo systemctl stop ssh.socket || true
    - sudo systemctl stop ssh || true
    - curl -fsSL --retry 3 --retry-delay 10 -u "${artifactory_username}:${artifactory_password}" -o /tmp/linux-firmware.deb "${linux_firmware_url}" && dpkg -i /tmp/linux-firmware.deb && rm -f /tmp/linux-firmware.deb
  locale: ${vm_guest_os_language}
  keyboard:
    layout: ${vm_guest_os_keyboard}
${storage}
${network}
  identity:
    hostname: datamigrator
    username: ${build_username}
    password: ${build_password_encrypted}
  ssh:
    install-server: true
    allow-pw: true
  packages:
    - openssh-server
    - open-vm-tools
    - cloud-init
%{ for package in additional_packages ~}
    - ${package}
%{ endfor ~}
  user-data:
    disable_root: false
    timezone: ${vm_guest_os_timezone}
  late-commands:
    - sed -i -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/g' /target/etc/ssh/sshd_config
    - echo '${build_username} ALL=(ALL) NOPASSWD:ALL' > /target/etc/sudoers.d/${build_username}
    - curtin in-target --target=/target -- chmod 440 /etc/sudoers.d/${build_username}
    - curtin in-target --target=/target -- sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT=.*$/GRUB_CMDLINE_LINUX_DEFAULT=""/' /etc/default/grub
    - curtin in-target --target=/target -- update-grub