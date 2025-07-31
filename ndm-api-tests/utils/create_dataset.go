package utils

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type FileEntry struct {
	SourcePath string `json:"source path"`
	Size       *int64 `json:"size"`
}

func runBatchCommand(cmds []string) error {
	fullCmd := strings.Join(cmds, " && ")
	sshConfig = SSHConfig{
		Username: NDM_WORKERS_USER_NAME,
		Host:     NDM_WORKERS_HOST,
		Port:     22,
		Password: NFS_NDM_WORKERS_PASSWORD,
	}

	fmt.Printf("UMV TRYING TO CONNECT : %+v \n", sshConfig)
	fmt.Println("UMV RUNNING : ", fullCmd)

	output, err := sshRunScript(sshConfig, fullCmd)
	if err != nil {
		fmt.Println("UMV ERROR OUTPUT : ", output)
		return err
	}

	return nil
}

func CreateSMBDataset() {
	jsonFilePath := "../../utils/input2.json"                             // Your input file
	smbShare := fmt.Sprintf(`\\%s\%s`, SOURCE_HOST_IP, SOURCE_VOLUMES[0]) // SMB path
	smbDrive := `Z:`                                                      // Temp drive letter
	username := PROTOCOL_USERNAME                                         // SMB username
	password := PROTOCOL_PASSWORD                                         // SMB password
	tempDir := `C:\delta`                                                 // Temporary local folder
	batchSize := 50

	// Read JSON
	data, err := os.ReadFile(jsonFilePath)
	if err != nil {
		panic(fmt.Errorf("failed to read JSON: %v", err))
	}

	var files []FileEntry
	if err := json.Unmarshal(data, &files); err != nil {
		panic(fmt.Errorf("failed to parse JSON: %v", err))
	}

	// Step 1: Cleanup and mkdir for base
	_ = runBatchCommand([]string{
		fmt.Sprintf(`if exist "%s" rmdir /s /q "%s"`, tempDir, tempDir),
		fmt.Sprintf(`mkdir "%s"`, tempDir),
	})

	// Step 2: Process in batches
	createdDirs := make(map[string]bool)

	for i := 0; i < len(files); i += batchSize {
		end := i + batchSize
		if end > len(files) {
			end = len(files)
		}

		var cmds []string
		for _, file := range files[i:end] {
			fmt.Println("UMV RELATIVE PATH : ", file.SourcePath)
			relativePath := strings.TrimPrefix(file.SourcePath, "/")
			targetPath := filepath.Join(tempDir, filepath.FromSlash(relativePath))
			dir := filepath.Dir(targetPath)

			if !createdDirs[dir] && !createdDirs[targetPath] {
				cmds = append(cmds, fmt.Sprintf(`mkdir "%s"`, dir))
				createdDirs[dir] = true
			}

			size := int64(1024)
			if file.Size != nil {
				size = *file.Size
			}

			if !createdDirs[targetPath] {
				cmds = append(cmds, fmt.Sprintf(`fsutil file createnew "%s" %d`, targetPath, size))
			}
		}

		// 🔥 Run the current batch
		if err := runBatchCommand(cmds); err != nil {
			fmt.Printf("Batch failed: %v\n", err)
			break
		}
		fmt.Println("------------------------")
	}

	// Step 3: Mount SMB, copy, cleanup
	finalCmds := []string{
		fmt.Sprintf(`net use %s %s /user:%s "%s"`, smbDrive, smbShare, username, password),
		fmt.Sprintf(`xcopy /E /I /Y "%s" "%s\"`, tempDir, smbDrive),
		fmt.Sprintf(`net use %s /delete /y`, smbDrive),
		fmt.Sprintf(`rmdir /s /q "%s"`, tempDir),
	}
	if err := runBatchCommand(finalCmds); err != nil {
		fmt.Printf("Final copy/cleanup failed: %v\n", err)
	}
}
