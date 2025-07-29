UPDATE error_remedies
SET
  description = 'Operation failed due to full disk or inode exhaustion.',
  resolution_steps = 'Clear unused data, remove unnecessary files, or increase disk/inode quota.',
  reference_commands = 'df -h; df -i; du -sh * | sort -h'
WHERE error_code = 'OP_NO_SPACE_LEFT';
