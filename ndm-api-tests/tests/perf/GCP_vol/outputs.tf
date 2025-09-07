output "volume_names" {
  description = "Names of created NetApp volumes"
  value       = google_netapp_volume.volumes[*].name
}

output "share_names" {
  description = "Share names of created volumes"
  value       = google_netapp_volume.volumes[*].share_name
}

output "nfs_export_addresses" {
  description = "Complete NFS export addresses in format ip:/mountpath"
  value = [
    for volume in google_netapp_volume.volumes : 
    volume.mount_options[0].export_full
  ]
}

output "volume_mount_info" {
  description = "Detailed mount information for each volume"
  value = [
    for i, volume in google_netapp_volume.volumes : {
      volume_name     = volume.name
      share_name      = volume.share_name
      export_path     = volume.mount_options[0].export
      export_full     = volume.mount_options[0].export_full
      nfs_address     = volume.mount_options[0].export_full
      capacity_gib    = volume.capacity_gib
      protocols       = volume.protocols
      state           = volume.state
      mount_instructions = volume.mount_options[0].instructions
    }
  ]
}

output "nfs_mount_commands" {
  description = "Ready-to-use NFS mount commands"
  value = [
    for volume in google_netapp_volume.volumes : 
    "sudo mount -t nfs ${volume.mount_options[0].export_full} /mnt/${volume.share_name}"
  ]
}

output "mount_instructions" {
  description = "Human-readable mount instructions from Google"
  value = google_netapp_volume.volumes[*].mount_options[0].instructions
}

output "deployment_summary" {
  description = "Summary with NFS addresses"
  value = {
    total_volumes_created = var.volume_count
    total_capacity_gib    = var.volume_count * var.volume_capacity_gib
    storage_pool_used     = var.storage_pool_name
    nfs_addresses        = [
      for volume in google_netapp_volume.volumes : 
      volume.mount_options[0].export_full
    ]
    cleanup_performed     = var.cleanup_existing_volumes
  }
}

output "volume_details" {
  description = "Complete volume information"
  value = [
    for volume in google_netapp_volume.volumes : {
      name           = volume.name
      id             = volume.id
      share_name     = volume.share_name
      capacity_gib   = volume.capacity_gib
      protocols      = volume.protocols
      state          = volume.state
      export_path    = volume.mount_options[0].export
      export_full    = volume.mount_options[0].export_full
      security_style = volume.security_style
      storage_pool   = var.storage_pool_name
      zone           = volume.zone
      service_level  = volume.service_level
      network        = volume.network
    }
  ]
}