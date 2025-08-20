package main

import (
	"fmt"
	"log"
	"os/exec"
)

// Batch VM creation example using Azure CLI
func main() {
	fmt.Println("🚀 NDM Infrastructure Creator (Batch Mode)")
	fmt.Println("=========================================")

	// Get common configuration
	fmt.Print("Enter username prefix for VM naming: ")
	var username string
	fmt.Scanln(&username)

	fmt.Print("Enter image version (e.g., 2025.19.08190213) or press Enter for latest: ")
	var imageVersion string
	fmt.Scanln(&imageVersion)

	// Configuration for batch VM creation
	configs := []VMConfig{
		{
			VMName:        fmt.Sprintf("%s-cp-azure-automated", username),
			VMType:        "control-plane",
			ImageVersion:  imageVersion,
			Username:      username,
			SubscriptionID: "1630c6a9-d99b-498a-aca8-a271f7506bc0",
			ResourceGroup: "datamigrate-acr-resource-group",
			Location:      "eastus",
			VNetName:      "datamigrate-vnet",
			SubnetName:    "default",
			GalleryName:   "datamigrator",
			AdminUsername: "ubuntu",
			AdminPassword: "Password@123",
		},
		{
			VMName:        fmt.Sprintf("%s-worker-001", username),
			VMType:        "worker",
			ImageVersion:  imageVersion,
			Username:      username,
			SubscriptionID: "1630c6a9-d99b-498a-aca8-a271f7506bc0",
			ResourceGroup: "datamigrate-acr-resource-group",
			Location:      "eastus",
			VNetName:      "datamigrate-vnet",
			SubnetName:    "default",
			GalleryName:   "datamigrator",
			AdminUsername: "ubuntu",
			AdminPassword: "Password@123",
		},
		{
			VMName:        fmt.Sprintf("%s-worker-002", username),
			VMType:        "worker",
			ImageVersion:  imageVersion,
			Username:      username,
			SubscriptionID: "1630c6a9-d99b-498a-aca8-a271f7506bc0",
			ResourceGroup: "datamigrate-acr-resource-group",
			Location:      "eastus",
			VNetName:      "datamigrate-vnet",
			SubnetName:    "default",
			GalleryName:   "datamigrator",
			AdminUsername: "ubuntu",
			AdminPassword: "Password@123",
		},
	}

	// Validate Azure CLI login
	if !checkAzureLogin() {
		log.Fatal("❌ Please run 'az login' first")
	}

	// Set subscription
	setSubscription(configs[0].SubscriptionID)

	fmt.Printf("\n📋 Creating %d VMs for NDM infrastructure...\n", len(configs))

	// Create all VMs
	for i, config := range configs {
		fmt.Printf("\n[%d/%d] Creating %s: %s\n", i+1, len(configs), config.VMType, config.VMName)
		
		err := createVM(config)
		if err != nil {
			log.Printf("❌ Failed to create VM %s: %v", config.VMName, err)
			continue
		}

		fmt.Printf("✅ Successfully created VM: %s\n", config.VMName)
	}

	fmt.Println("\n🎯 NDM Infrastructure deployment complete!")
	fmt.Println("📊 Your environment is ready for performance testing!")
	fmt.Printf("🔗 Control Plane: %s-cp-azure-automated\n", username)
	fmt.Printf("👷 Workers: %s-worker-001, %s-worker-002\n", username, username)
}

// Note: This would use the same functions from create-vm-cli.go
// In practice, you'd either import them or combine into a single file
