# Create Linux VM on GCP
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

  advanced_machine_features {
    enable_nested_virtualization = false
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
    enable-oslogin = "FALSE"
    ssh-keys       = var.admin_username != "" && var.admin_ssh_public_key != "" ? "${var.admin_username}:${var.admin_ssh_public_key}" : ""
  }

  metadata_startup_script = var.startup_script != "" ? var.startup_script : ""

  labels = var.labels

  connection {
    type        = "ssh"
    user        = var.admin_username
    private_key = var.admin_ssh_private_key
    host        = self.network_interface.0.network_ip
    timeout     = "5m"
  }

  provisioner "remote-exec" {
    inline = [
      "echo 'Waiting for SSH key propagation...'",
      "sleep 10",
      "sudo sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config",
      "sudo sed -i 's/^#\\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication yes/' /etc/ssh/sshd_config",
      "sudo sh -c \"printf 'PasswordAuthentication yes\\nKbdInteractiveAuthentication yes\\n' > /etc/ssh/sshd_config.d/00-password-auth.conf\"",
      "sudo find /etc/ssh/sshd_config.d/ -name '*.conf' ! -name '00-password-auth.conf' -exec sudo sed -i '/^\\s*PasswordAuthentication/d' {} + 2>/dev/null || true",
      "echo '${var.admin_username}:${var.admin_password}' | sudo chpasswd",
      "sudo usermod -aG sudo '${var.admin_username}'",
      "echo '${var.admin_username} ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/${var.admin_username} > /dev/null",
      "sudo chmod 0440 /etc/sudoers.d/${var.admin_username}",
      "sudo systemctl restart sshd || sudo systemctl restart ssh",
      "echo 'Password authentication enabled successfully'",
    ]
  }
}
