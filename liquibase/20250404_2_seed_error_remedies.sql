INSERT INTO error_remedies (error_code, description, resolution_steps, reference_commands) VALUES

-- FILE/DIRECTORY ERRORS
('TASK_FILE_NOT_FOUND', 'Task failed due to missing file or directory.', 'Ensure the input file path is correct and the file exists.', 'ls -l /path/to/file'),
('OP_FILE_NOT_FOUND', 'Operation failed due to missing file or directory.', 'Verify the file or directory exists and is correctly referenced.', 'find / -name <filename>'),

('TASK_PERMISSION_DENIED', 'Task lacks necessary permissions to access the resource.', 'Grant the task appropriate permissions.', 'chmod +x /path/to/file; chown $USER:$USER /path/to/file'),
('OP_PERMISSION_DENIED', 'Operation lacks necessary permissions.', 'Ensure the user or process has sufficient permissions.', 'ls -la /path; sudo chown'),

-- TOO MANY FILES
('TASK_TOO_MANY_OPEN_FILES', 'Too many files open during task.', 'Increase the system open file limit.', 'ulimit -n; sudo vim /etc/security/limits.conf'),
('OP_TOO_MANY_OPEN_FILES', 'Operation has exceeded file handle limit.', 'Close unused files or increase limit.', 'lsof | wc -l'),

-- DIRECTORY/FILE TYPE ISSUES
('TASK_NOT_A_DIRECTORY', 'Expected a directory but found a file.', 'Check the path and ensure it points to a directory.', 'file /path/to/item'),
('OP_NOT_A_DIRECTORY', 'Operation expected directory but found file.', 'Correct the resource path.', 'ls -ld /path'),

('TASK_IS_A_DIRECTORY', 'Expected a file but found a directory.', 'Ensure the path leads to a file.', 'ls -ld /path/to/item'),
('OP_IS_A_DIRECTORY', 'Expected file but got a directory.', 'Use the correct file path.', 'file /path/to/item'),

-- DISK/FILESYSTEM ERRORS
('TASK_NO_SPACE_LEFT', 'No space left on device for task.', 'Free up disk space or expand the disk.', 'df -h; du -sh * | sort -h'),
('OP_NO_SPACE_LEFT', 'Operation failed due to full disk.', 'Clear unused data or increase disk quota.', 'df -h; du -sh * | sort -h'),

('TASK_READ_ONLY_FILESYSTEM', 'Task tried to write to a read-only file system.', 'Remount filesystem with write access or choose another directory.', 'mount -o remount,rw /mount/point'),
('OP_READ_ONLY_FILESYSTEM', 'Operation failed due to read-only mount.', 'Use writable mount or remount the FS.', 'mount | grep ro,'),

-- RESOURCE BUSY
('TASK_RESOURCE_BUSY', 'File or resource is currently in use.', 'Ensure no other process is locking the resource.', 'lsof /path/to/file'),
('OP_RESOURCE_BUSY', 'Resource locked by another process.', 'Wait or free the resource.', 'fuser -v /path/to/resource'),

-- SYMBOLIC LINK ERRORS
('TASK_TOO_MANY_SYMLINKS', 'Too many symbolic links encountered.', 'Check for circular symlinks.', 'readlink -f /path/to/link'),
('OP_TOO_MANY_SYMLINKS', 'Exceeded symlink depth.', 'Simplify the path or remove excessive symlinks.', 'find -L /path -type l'),

-- NETWORK ISSUES
('TASK_CONNECTION_RESET', 'Connection reset by remote server.', 'Check network stability and server status.', 'ping <host>; telnet <host> <port>'),
('OP_CONNECTION_RESET', 'Connection was unexpectedly closed.', 'Verify network and service health.', 'curl -v http://<host>'),

('TASK_OPERATION_TIMED_OUT', 'The task timed out.', 'Retry with a higher timeout or improve performance.', 'curl --max-time 30 http://<host>'),
('OP_OPERATION_TIMED_OUT', 'The operation exceeded its time limit.', 'Adjust timeout settings or debug latency.', 'traceroute <host>'),

('TASK_NETWORK_DOWN', 'Network interface appears to be down.', 'Reconnect or troubleshoot the interface.', 'ip a; nmcli device status'),
('OP_NETWORK_DOWN', 'Operation failed due to no network.', 'Restart network or check configuration.', 'systemctl restart NetworkManager'),

('TASK_CONNECTION_REFUSED', 'The target actively refused the connection.', 'Check if the target service is running.', 'nc -zv <host> <port>'),
('OP_CONNECTION_REFUSED', 'Connection attempt was rejected.', 'Verify target availability and firewall.', 'ss -ltnp'),

-- PIPE / IO
('TASK_BROKEN_PIPE', 'Broken pipe encountered during task.', 'Ensure the sending and receiving processes are properly handled.', 'dmesg | grep pipe'),
('OP_BROKEN_PIPE', 'Broken communication pipe in operation.', 'Retry operation and check logs.', 'ps aux | grep <app>'),

-- NAME TOO LONG
('TASK_FILENAME_TOO_LONG', 'The filename exceeds system limit.', 'Use shorter file or directory names.', 'echo ${#FILENAME}'),
('OP_FILENAME_TOO_LONG', 'Path length exceeds maximum allowed.', 'Shorten nested directory structure.', 'realpath /path | wc -c'),

-- GENERIC I/O
('TASK_SERVER_DISCONNECTED', 'Lost connection to the server.', 'Retry and check server logs.', 'systemctl status <service>; journalctl -xe'),
('OP_SERVER_DISCONNECTED', 'Server disconnected during operation.', 'Ensure the server is stable and reachable.', 'ping <host>; systemctl restart <service>'),

-- FALLBACK / UNKNOWN
('TASK_UNKNOWN_ERROR', 'An unknown error occurred in task.', 'Inspect logs and contact support.', 'tail -n 100 /opt/datamigrator/logs/datamigrator-worker.log | grep JOB_RUN_ID'),
('OP_UNKNOWN_ERROR', 'Unidentified error occurred.', 'Check system logs or enable verbose mode.', 'tail -n 100 /opt/datamigrator/logs/datamigrator-worker.log | grep JOB_RUN_ID'),

('TASK_GENERAL_FAILURE', 'General task failure.', 'Retry or check dependencies.', 'journalctl -xe'),
('OP_GENERAL_FAILURE', 'General failure in operation.', 'Review logs and validate inputs.', 'cat /opt/datamigrator/logs/datamigrator-worker.log | tail');
