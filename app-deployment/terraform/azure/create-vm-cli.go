package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"

	"github.com/joho/godotenv"
)

type VMConfig struct {
	VMName               string
	VMType               string // "control-plane" or "worker"
	ImageVersion         string
	Username             string
	SubscriptionID       string
	ResourceGroup        string
	Location             string
	VNetName             string
	SubnetName           string
	GalleryName          string
	AdminUsername        string
	AdminPassword        string
	CPImageVersion       string
	WorkerImageVersion   string
}

type VMInfo struct {
	Name string
	Type string
}

func main() {
	// Load environment variables
	err := godotenv.Load("../../../tests/.env")
	if err != nil {
		log.Printf("Warning: Could not load .env file: %v", err)
	}

	fmt.Println("🚀 Azure VM Creator for NDM (Using Azure CLI)")
	fmt.Println("==============================================")

	// Get configuration
	baseConfig := getBaseConfig()

	// Validate Azure CLI login
	if !checkAzureLogin() {
		log.Fatal("❌ Please run 'az login' first")
	}

	// Set subscription
	setSubscription(baseConfig.SubscriptionID)

	// Create both control plane and worker VMs
	var createdVMs []VMInfo
	
	// Create control plane VM
	cpConfig := baseConfig
	cpConfig.VMType = "control-plane"
	cpConfig.VMName = fmt.Sprintf("%s-cp-azure-automated", baseConfig.Username)
	cpConfig.ImageVersion = baseConfig.CPImageVersion
	
	fmt.Printf("\n🔧 Creating control-plane VM: %s\n", cpConfig.VMName)
	fmt.Printf("📍 Location: %s\n", cpConfig.Location)
	fmt.Printf("📦 Control-Plane Image Version: %s\n", cpConfig.ImageVersion)

	err = createVM(cpConfig)
	if err != nil {
		log.Printf("❌ Failed to create control-plane VM: %v", err)
	} else {
		fmt.Printf("✅ Successfully created control-plane VM: %s\n", cpConfig.VMName)
		createdVMs = append(createdVMs, VMInfo{Name: cpConfig.VMName, Type: "control-plane"})
	}

	// Create worker VM
	workerConfig := baseConfig
	workerConfig.VMType = "worker"
	workerConfig.VMName = fmt.Sprintf("%s-worker-azure-automated", baseConfig.Username)
	workerConfig.ImageVersion = baseConfig.WorkerImageVersion
	
	fmt.Printf("\n🔧 Creating worker VM: %s\n", workerConfig.VMName)
	fmt.Printf("📍 Location: %s\n", workerConfig.Location)
	fmt.Printf("📦 Worker Image Version: %s\n", workerConfig.ImageVersion)

	err = createVM(workerConfig)
	if err != nil {
		log.Printf("❌ Failed to create worker VM: %v", err)
	} else {
		fmt.Printf("✅ Successfully created worker VM: %s\n", workerConfig.VMName)
		createdVMs = append(createdVMs, VMInfo{Name: workerConfig.VMName, Type: "worker"})
	}

	// Print IP addresses for all created VMs
	if len(createdVMs) > 0 {
		fmt.Println("\n🌐 VM IP Addresses:")
		fmt.Println("====================")
		for _, vm := range createdVMs {
			ip, err := getVMIP(vm.Name, baseConfig.ResourceGroup)
			if err != nil {
				fmt.Printf("❌ %s (%s): Failed to get IP - %v\n", vm.Name, vm.Type, err)
			} else {
				fmt.Printf("✅ %s (%s): %s\n", vm.Name, vm.Type, ip)
			}
		}
		fmt.Println("\n🎯 All VMs are ready for NDM deployment!")
	} else {
		fmt.Println("❌ No VMs were created successfully")
	}
}

func getBaseConfig() VMConfig {
	// Default values from Terraform configuration
	config := VMConfig{
		SubscriptionID: "1630c6a9-d99b-498a-aca8-a271f7506bc0",
		ResourceGroup:  "datamigrate-acr-resource-group", 
		Location:       "eastus",
		VNetName:       "datamigrate-dev-vnet",
		SubnetName:     "default",
		GalleryName:    "datamigrator",
		AdminUsername:  "ubuntu",
		AdminPassword:  "Password@123",
	}

	// Get user inputs
	fmt.Print("Enter username prefix for VM naming: ")
	fmt.Scanln(&config.Username)

	fmt.Print("Enter control-plane image version (e.g., 2025.19.08190213) or press Enter for latest: ")
	fmt.Scanln(&config.CPImageVersion)

	fmt.Print("Enter worker image version (e.g., 2025.19.08190213) or press Enter for latest: ")
	fmt.Scanln(&config.WorkerImageVersion)

	return config
}

func checkAzureLogin() bool {
	cmd := exec.Command("az", "account", "show")
	err := cmd.Run()
	return err == nil
}

func setSubscription(subscriptionID string) {
	fmt.Printf("🔧 Setting subscription to: %s\n", subscriptionID)
	cmd := exec.Command("az", "account", "set", "--subscription", subscriptionID)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		log.Fatalf("Failed to set subscription: %v", err)
	}
}

func createVM(config VMConfig) error {
	// Step 1: Get image ID
	imageID, err := getImageID(config)
	if err != nil {
		return fmt.Errorf("failed to get image ID: %w", err)
	}

	// Step 2: Get subnet ID  
	subnetID, err := getSubnetID(config)
	if err != nil {
		return fmt.Errorf("failed to get subnet ID: %w", err)
	}

	// Step 3: Create VM using az vm create
	vmSize := getVMSize(config.VMType)
	
	fmt.Println("📡 Creating virtual machine (no public IP)...")
	cmd := exec.Command("az", "vm", "create",
		"--resource-group", config.ResourceGroup,
		"--name", config.VMName,
		"--image", imageID,
		"--size", vmSize,
		"--admin-username", config.AdminUsername,
		"--admin-password", config.AdminPassword,
		"--authentication-type", "password",
		"--subnet", subnetID,
		"--location", config.Location,
		"--zone", "1",
		"--storage-sku", "Premium_LRS",
		"--os-disk-size-gb", "200",
		"--security-type", "TrustedLaunch",
		"--enable-secure-boot", "true",
		"--enable-vtpm", "true",
		"--nic-delete-option", "Delete",
		"--os-disk-delete-option", "Delete",
		"--public-ip-address", "",
		"--tags", "environment=dev", "owner="+config.Username,
		"--output", "json")

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("VM creation failed: %v\nOutput: %s", err, output)
	}

	fmt.Println("✅ VM created successfully!")
	return nil
}

func getImageID(config VMConfig) (string, error) {
	var imageDefinition string
	if config.VMType == "control-plane" {
		imageDefinition = "ndm-control-plane"
	} else {
		imageDefinition = "ndm-worker"
	}

	if config.ImageVersion == "" {
		// Get latest version
		fmt.Printf("🔍 Getting latest %s image...\n", imageDefinition)
		cmd := exec.Command("az", "sig", "image-version", "list",
			"--resource-group", config.ResourceGroup,
			"--gallery-name", config.GalleryName,
			"--gallery-image-definition", imageDefinition,
			"--query", "[0].id",
			"--output", "tsv")
	
		output, err := cmd.Output()
		if err != nil {
			return "", fmt.Errorf("failed to get latest image: %v", err)
		}
		return strings.TrimSpace(string(output)), nil
	} else {
		// Get specific version
		fmt.Printf("🔍 Getting %s image version %s...\n", imageDefinition, config.ImageVersion)
		cmd := exec.Command("az", "sig", "image-version", "show",
			"--resource-group", config.ResourceGroup,
			"--gallery-name", config.GalleryName,
			"--gallery-image-definition", imageDefinition,
			"--gallery-image-version", config.ImageVersion,
			"--query", "id",
			"--output", "tsv")

		output, err := cmd.Output()
		if err != nil {
			return "", fmt.Errorf("failed to get image version %s: %v", config.ImageVersion, err)
		}
		return strings.TrimSpace(string(output)), nil
	}
}

func getSubnetID(config VMConfig) (string, error) {
	fmt.Printf("🔍 Getting subnet ID for %s/%s...\n", config.VNetName, config.SubnetName)
	cmd := exec.Command("az", "network", "vnet", "subnet", "show",
		"--resource-group", config.ResourceGroup,
		"--vnet-name", config.VNetName,
		"--name", config.SubnetName,
		"--query", "id",
		"--output", "tsv")

	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get subnet ID: %v", err)
	}
	return strings.TrimSpace(string(output)), nil
}

func getVMSize(vmType string) string {
	switch vmType {
	case "control-plane":
		return "Standard_D8s_v3" // 8 vCPUs, 32 GB RAM
	case "worker":
		return "Standard_D4s_v3" // 4 vCPUs, 16 GB RAM
	default:
		return "Standard_D4s_v3"
	}
}

func getVMIP(vmName, resourceGroup string) (string, error) {
	cmd := exec.Command("az", "vm", "show",
		"--resource-group", resourceGroup,
		"--name", vmName,
		"--show-details",
		"--query", "privateIps",
		"--output", "tsv")

	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get VM IP: %v", err)
	}
	
	ip := strings.TrimSpace(string(output))
	if ip == "" {
		return "", fmt.Errorf("no private IP found")
	}
	return ip, nil
}
