package main

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	err := godotenv.Load("../../../tests/.env")
	if err != nil {
		log.Printf("Warning: Could not load .env file: %v", err)
	}

	fmt.Println("🚀 Azure VM Creator for NDM Control Plane & Workers")
	fmt.Println("====================================================")

	// Get Azure subscription and resource group from environment or user input
	subscriptionID := getEnvOrPrompt("AZURE_SUBSCRIPTION_ID", "Enter Azure Subscription ID: ")
	resourceGroupName := getEnvOrPrompt("AZURE_RESOURCE_GROUP", "Enter Resource Group Name: ")
	location := getEnvOrPrompt("AZURE_LOCATION", "Enter Location (e.g., eastus): ")

	// Prompt for VM details
	fmt.Print("Enter VM name prefix (e.g., kb-test): ")
	var vmPrefix string
	fmt.Scanln(&vmPrefix)

	fmt.Print("Enter VM type (1=control-plane, 2=worker): ")
	var vmTypeChoice string
	fmt.Scanln(&vmTypeChoice)

	var vmType string
	switch vmTypeChoice {
	case "1":
		vmType = "control-plane"
	case "2":
		vmType = "worker"
	default:
		log.Fatal("Invalid VM type choice. Please enter 1 or 2.")
	}

	fmt.Print("Enter image version (e.g., 2025.19.08190213): ")
	var imageVersion string
	fmt.Scanln(&imageVersion)

	// Create VM configuration
	config := VMConfig{
		SubscriptionID:    subscriptionID,
		ResourceGroupName: resourceGroupName,
		Location:          location,
		VMName:            fmt.Sprintf("%s-%s-001", vmPrefix, vmType),
		VMType:            vmType,
		ImageVersion:      imageVersion,
		VMSize:            GetVMSize(vmType),
		AdminUsername:     "ubuntu",
		AdminPassword:     "Password@123", // Should be from environment in production
		VnetName:          "datamigrate-vnet",
		SubnetName:        "default",
		Zone:              "1",
	}

	// Create VM
	creator, err := NewVMCreator(config.SubscriptionID)
	if err != nil {
		log.Fatalf("Failed to create VM creator: %v", err)
	}

	fmt.Printf("\n🔧 Creating %s VM: %s\n", config.VMType, config.VMName)
	fmt.Printf("📍 Location: %s\n", config.Location)
	fmt.Printf("🖥️  VM Size: %s\n", config.VMSize)
	fmt.Printf("📦 Image Version: %s\n", config.ImageVersion)

	err = creator.CreateVM(config)
	if err != nil {
		log.Fatalf("Failed to create VM: %v", err)
	}

	fmt.Printf("✅ Successfully created VM: %s\n", config.VMName)
	fmt.Printf("🎯 VM is ready for NDM %s deployment!\n", config.VMType)
}

func getEnvOrPrompt(envVar, prompt string) string {
	value := os.Getenv(envVar)
	if value != "" {
		return value
	}

	fmt.Print(prompt)
	var input string
	fmt.Scanln(&input)
	return strings.TrimSpace(input)
}
