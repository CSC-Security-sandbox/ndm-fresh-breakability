# Get Windows subnet 
data "azurerm_subnet" "subnet" {
  name                 = var.subnet_name
  virtual_network_name = var.vnet_name
  resource_group_name  = var.resource_group
}

# Create public IP if requested
resource "azurerm_public_ip" "public_ip" {
  count               = var.assign_public_ip ? 1 : 0
  name                = "${var.vm_name}-public-ip"
  location            = var.location
  resource_group_name = var.resource_group
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = var.tags
}

# Create network interface
resource "azurerm_network_interface" "nic" {
  name                = "${var.vm_name}-nic"
  location            = var.location
  resource_group_name = var.resource_group

  ip_configuration {
    name                          = "internal"
    subnet_id                     = data.azurerm_subnet.subnet.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = var.assign_public_ip ? azurerm_public_ip.public_ip[0].id : null
  }

  tags = var.tags
}

# Create Windows Virtual Machine
resource "azurerm_windows_virtual_machine" "vm" {
  name                     = var.vm_name
  computer_name            = var.computer_name
  resource_group_name      = var.resource_group
  location                 = var.location
  size                     = var.vm_size
  admin_username           = var.admin_username
  admin_password           = var.admin_password
  timezone                 = var.timezone
  enable_automatic_updates = var.enable_automatic_updates

  network_interface_ids = [
    azurerm_network_interface.nic.id,
  ]

  os_disk {
    caching              = var.os_disk_caching
    storage_account_type = var.os_disk_storage_account_type
  }

  # Use marketplace Windows image
  source_image_reference {
    publisher = var.windows_image_publisher
    offer     = var.windows_image_offer
    sku       = var.windows_image_sku
    version   = var.windows_image_version
  }

  tags = var.tags
}

resource "azurerm_virtual_machine_extension" "openssh_setup" {
  count                = var.enable_openssh ? 1 : 0
  name                 = "${var.vm_name}-openssh-setup"
  virtual_machine_id   = azurerm_windows_virtual_machine.vm.id
  publisher            = "Microsoft.Compute"
  type                 = "CustomScriptExtension"
  type_handler_version = "1.9"

  protected_settings = <<SETTINGS
  {
    "commandToExecute": "powershell -Command \"$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; try { $capability = Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Start-Service sshd; Set-Service -Name sshd -StartupType 'Automatic'; New-NetFirewallRule -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue; 'OpenSSH installed and configured successfully at ' + $timestamp | Out-File -FilePath C:\\openssh-setup-success.txt -Force; 'OpenSSH setup completed successfully!' | Out-File -FilePath C:\\Users\\Public\\Desktop\\openssh-result.txt -Force } catch { 'OpenSSH setup failed: ' + $_.Exception.Message | Out-File -FilePath C:\\openssh-setup-error.txt -Force }\""
  }
  SETTINGS

  depends_on = [
    azurerm_windows_virtual_machine.vm
  ]

  tags = var.tags
}
