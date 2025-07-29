UPDATE error_remedies 
SET 
    description = 'Operation failed due to full disk.', 
    resolution_steps = 'Clear unused data or increase disk quota.', 
    reference_commands = 'df -h; du -sh * | sort -h' 
WHERE error_code = 'OP_NO_SPACE_LEFT';
