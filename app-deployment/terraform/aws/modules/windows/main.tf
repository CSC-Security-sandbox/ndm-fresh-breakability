data "aws_ami" "windows_2022" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["Windows_Server-2022-English-Full-Base-*"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

resource "aws_instance" "vm" {
  ami                    = data.aws_ami.windows_2022.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [var.security_group_id]
  key_name               = var.key_name

  user_data = <<-USERDATA
<powershell>
$password = "${var.admin_password}"
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$user = [adsi]"WinNT://./Administrator,user"
$user.SetPassword($password)
$user.SetInfo()

try {
  New-LocalUser -Name "${var.admin_username}" -Password $securePassword -FullName "Data Migrator" -Description "NDM service account" -PasswordNeverExpires -ErrorAction Stop
  Add-LocalGroupMember -Group "Administrators" -Member "${var.admin_username}"
  "User ${var.admin_username} created" | Out-File -FilePath "C:\user-setup.txt" -Force
} catch {
  "User creation note: $($_.Exception.Message)" | Out-File -FilePath "C:\user-setup.txt" -Force
}

New-Item -ItemType Directory -Force -Path "C:\Temp" | Out-Null

try {
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
  $timeout = 180; $elapsed = 0
  while (!(Get-Service sshd -ErrorAction SilentlyContinue) -and $elapsed -lt $timeout) {
    Start-Sleep -Seconds 5; $elapsed += 5
  }

  Start-Service sshd
  Set-Service -Name sshd -StartupType Automatic
  New-NetFirewallRule -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue

  $sshdConfig = "$env:ProgramData\ssh\sshd_config"
  $elapsed = 0
  while (!(Test-Path $sshdConfig) -and $elapsed -lt 60) {
    Start-Sleep -Seconds 5; $elapsed += 5
  }

  if (Test-Path $sshdConfig) {
    $content = Get-Content $sshdConfig
    $content = $content -replace '#PasswordAuthentication yes', 'PasswordAuthentication yes'
    $content = $content -replace 'PasswordAuthentication no', 'PasswordAuthentication yes'
    $content | Set-Content $sshdConfig
  } else {
    "PasswordAuthentication yes`nSubsystem sftp sftp-server.exe" | Out-File -FilePath $sshdConfig -Encoding ascii
  }

  $adminAuthKeys = "$env:ProgramData\ssh\administrators_authorized_keys"
  if (Test-Path $adminAuthKeys) { Remove-Item $adminAuthKeys -Force }

  Restart-Service sshd
  "OpenSSH configured successfully" | Out-File -FilePath "C:\openssh-setup-success.txt" -Force
} catch {
  $_ | Out-File -FilePath "C:\openssh-setup-error.txt" -Force
}

New-NetFirewallRule -DisplayName "Allow ICMPv4" -Protocol ICMPv4 -IcmpType 8 -Direction Inbound -Action Allow -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Allow RDP" -Protocol TCP -LocalPort 3389 -Direction Inbound -Action Allow -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Allow SMB" -Protocol TCP -LocalPort 445 -Direction Inbound -Action Allow -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Allow HTTPS" -Protocol TCP -LocalPort 443 -Direction Inbound -Action Allow -ErrorAction SilentlyContinue

Set-SmbClientConfiguration -MaxCmds 128 -ConnectionCountPerRssNetworkInterface 4 -DirectoryCacheLifetime 30 -FileInfoCacheLifetime 30 -FileNotFoundCacheLifetime 30 -EnableMultiChannel $true -EnableBandwidthThrottling $false -EnableLargeMtu $true -Force
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name TcpWindowSize -Value 4194304 -Type DWord
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name GlobalMaxTcpWindowSize -Value 4194304 -Type DWord
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name Tcp1323Opts -Value 3 -Type DWord
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' -Name MaxCmds -Value 128 -Type DWord
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' -Name MaxCollectionCount -Value 32 -Type DWord
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' -Name RequireSecuritySignature -Value 0 -Type DWord

"Setup completed" | Out-File -FilePath "C:\setup-success.txt" -Force
</powershell>
USERDATA

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = merge(var.tags, {
    Name = var.instance_name
  })
}
