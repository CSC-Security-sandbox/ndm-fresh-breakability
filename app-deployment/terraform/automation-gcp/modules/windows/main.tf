# Windows VM on GCP — uses marketplace Windows Server image and a PowerShell
# startup script that mirrors the Azure CustomScriptExtension for SMB/TCP
# tuning and optional OpenSSH setup.

locals {
  # PowerShell startup script run once on first boot.
  # Sets the admin password, tunes SMB/TCP for cross-region migration
  # throughput, and optionally installs OpenSSH Server.
  startup_script = <<-PS1
    # Set admin password
    $securePassword = ConvertTo-SecureString '${var.admin_password}' -AsPlainText -Force
    $user = Get-LocalUser -Name '${var.admin_username}' -ErrorAction SilentlyContinue
    if ($user) {
      Set-LocalUser -Name '${var.admin_username}' -Password $securePassword
    } else {
      New-LocalUser -Name '${var.admin_username}' -Password $securePassword -FullName '${var.admin_username}' -PasswordNeverExpires
      Add-LocalGroupMember -Group 'Administrators' -Member '${var.admin_username}'
    }

    ${length(var.dns_servers) > 0 ? local.dns_block : "# No custom DNS servers configured"}

    # SMB client: increase outstanding commands, enable multichannel, disable
    # bandwidth throttling, enable large MTU
    Set-SmbClientConfiguration -MaxCmds 128 `
      -ConnectionCountPerRssNetworkInterface 4 `
      -DirectoryCacheLifetime 30 `
      -FileInfoCacheLifetime 30 `
      -FileNotFoundCacheLifetime 30 `
      -EnableMultiChannel $true `
      -EnableBandwidthThrottling $false `
      -EnableLargeMtu $true -Force

    # TCP: increase window size to 4 MB, enable window scaling + timestamps
    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' `
      -Name TcpWindowSize -Value 4194304 -Type DWord
    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' `
      -Name GlobalMaxTcpWindowSize -Value 4194304 -Type DWord
    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' `
      -Name Tcp1323Opts -Value 3 -Type DWord

    # LanmanWorkstation: increase max commands, write coalescing, disable SMB
    # signing for throughput
    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' `
      -Name MaxCmds -Value 128 -Type DWord
    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' `
      -Name MaxCollectionCount -Value 32 -Type DWord
    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' `
      -Name RequireSecuritySignature -Value 0 -Type DWord

    'SMB and TCP tuning applied' | Out-File -FilePath C:\smb-tcp-tuning-success.txt -Force

    ${var.enable_openssh ? local.openssh_block : "# OpenSSH disabled"}

    # Create C:\Temp for installer staging
    New-Item -ItemType Directory -Force -Path 'C:\Temp' | Out-Null
  PS1

  dns_block = <<-PS1
    # Configure custom DNS servers for AD domain resolution
    $adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
    foreach ($adapter in $adapters) {
      Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses @(${join(",", [for s in var.dns_servers : "'${s}'"])})
    }
    'Custom DNS servers configured: ${join(", ", var.dns_servers)}' | Out-File -FilePath C:\dns-setup-success.txt -Force
  PS1

  openssh_block = <<-PS1
    # Install and configure OpenSSH Server
    try {
      Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
      Start-Service sshd
      Set-Service -Name sshd -StartupType 'Automatic'
      New-NetFirewallRule -DisplayName 'OpenSSH Server (sshd)' `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow `
        -LocalPort 22 -ErrorAction SilentlyContinue
      'OpenSSH installed and configured successfully' | Out-File -FilePath C:\openssh-setup-success.txt -Force
    } catch {
      "OpenSSH setup failed: $($_.Exception.Message)" | Out-File -FilePath C:\openssh-setup-error.txt -Force
    }
  PS1
}

resource "google_compute_instance" "vm" {
  name         = var.vm_name
  machine_type = var.machine_type
  zone         = var.zone

  boot_disk {
    initialize_params {
      image = var.image
      size  = var.disk_size_gb
      type  = var.disk_type
    }
  }

  network_interface {
    network    = var.network
    subnetwork = var.subnetwork
    nic_type   = var.enable_gvnic ? "GVNIC" : "VIRTIO_NET"

    dynamic "access_config" {
      for_each = var.assign_public_ip ? [1] : []
      content {}
    }
  }

  tags = var.network_tags

  metadata = {
    windows-startup-script-ps1 = local.startup_script
  }

  labels = var.labels
}
