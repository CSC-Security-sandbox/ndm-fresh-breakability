package main

import (
	"fmt"
	"log"
	"os"
)

// Example script showing how to create multiple VMs programmatically
func main() {
	// Configuration for batch VM creation
	configs := []VMConfig{
		{
			SubscriptionID:    "1630c6a9-d99b-498a-aca8-a271f7506bc0",
			ResourceGroupName: "datamigrate-acr-resource-group",
			Location:          "eastus",
			VMName:            "ndm-cp-001",
			VMType:            "control-plane",
			ImageVersion:      "2025.19.08190213",
			VMSize:            "Standard_D8s_v3",
			AdminUsername:     "ubuntu",
			AdminPassword:     getPasswordFromEnv(), 
			VnetName:          "datamigrate-vnet",
			SubnetName:        "default",
			Zone:              "1",
		},
		{
			SubscriptionID:    "1630c6a9-d99b-498a-aca8-a271f7506bc0",
			ResourceGroupName: "datamigrate-acr-resource-group",
			Location:          "eastus",
			VMName:            "ndm-worker-001",
			VMType:            "worker",
			ImageVersion:      "2025.19.08190213",
			VMSize:            "Standard_D4s_v3",
			AdminUsername:     "ubuntu",
			AdminPassword:     getPasswordFromEnv(),
			VnetName:          "datamigrate-vnet",
			SubnetName:        "default",
			Zone:              "1",
		},
		{
			SubscriptionID:    "1630c6a9-d99b-498a-aca8-a271f7506bc0",
			ResourceGroupName: "datamigrate-acr-resource-group",
			Location:          "eastus",
			VMName:            "ndm-worker-002",
			VMType:            "worker",
			ImageVersion:      "2025.19.08190213",
			VMSize:            "Standard_D4s_v3",
			AdminUsername:     "ubuntu",
			AdminPassword:     getPasswordFromEnv(),
			VnetName:          "datamigrate-vnet",
			SubnetName:        "default",
			Zone:              "2", // Different zone for HA
		},
	}

	fmt.Println("🚀 Creating NDM Infrastructure...")
	fmt.Printf("📋 Creating %d VMs\n", len(configs))

	// Create VM creator
	creator, err := NewVMCreator(configs[0].SubscriptionID)
	if err != nil {
		log.Fatalf("Failed to create VM creator: %v", err)
	}

	// Create all VMs
	for i, config := range configs {
		fmt.Printf("\n[%d/%d] Creating %s: %s\n", i+1, len(configs), config.VMType, config.VMName)
		
		err := creator.CreateVM(config)
		if err != nil {
			log.Printf("❌ Failed to create VM %s: %v", config.VMName, err)
			continue
		}

		fmt.Printf("✅ Successfully created VM: %s\n", config.VMName)
	}

	fmt.Println("\n🎯 NDM Infrastructure deployment complete!")
	fmt.Println("📊 Ready for performance testing!")
}

func getPasswordFromEnv() string {
	password := os.Getenv("AZURE_VM_PASSWORD")
	if password == "" {
		return "Password@123" // Default fallback
	}
	return password
}
