package main

import (
	"context"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore/to"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/compute/armcompute/v4"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/network/armnetwork/v2"
)

type VMConfig struct {
	SubscriptionID    string
	ResourceGroupName string
	Location          string
	VMName            string
	VMType            string // "control-plane" or "worker"
	ImageVersion      string
	VMSize            string
	AdminUsername     string
	AdminPassword     string
	VnetName          string
	SubnetName        string
	Zone              string
}

type VMCreator struct {
	computeClient *armcompute.VirtualMachinesClient
	networkClient *armnetwork.InterfacesClient
	vnetClient    *armnetwork.VirtualNetworksClient
	subnetClient  *armnetwork.SubnetsClient
	ctx           context.Context
}

func NewVMCreator(subscriptionID string) (*VMCreator, error) {
	// Create Azure credential
	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create credential: %w", err)
	}

	ctx := context.Background()

	// Create clients
	computeClient, err := armcompute.NewVirtualMachinesClient(subscriptionID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create compute client: %w", err)
	}

	networkClient, err := armnetwork.NewInterfacesClient(subscriptionID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create network client: %w", err)
	}

	vnetClient, err := armnetwork.NewVirtualNetworksClient(subscriptionID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create vnet client: %w", err)
	}

	subnetClient, err := armnetwork.NewSubnetsClient(subscriptionID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create subnet client: %w", err)
	}

	return &VMCreator{
		computeClient: computeClient,
		networkClient: networkClient,
		vnetClient:    vnetClient,
		subnetClient:  subnetClient,
		ctx:           ctx,
	}, nil
}

func (vc *VMCreator) CreateVM(config VMConfig) error {
	// Create network interface
	fmt.Println("📡 Creating network interface...")
	nicName := fmt.Sprintf("%s-nic", config.VMName)
	nicID, err := vc.createNetworkInterface(config, nicName)
	if err != nil {
		return fmt.Errorf("failed to create network interface: %w", err)
	}

	// Create VM
	fmt.Println("🖥️  Creating virtual machine...")
	vm := armcompute.VirtualMachine{
		Location: to.Ptr(config.Location),
		Zones:    []*string{to.Ptr(config.Zone)},
		Properties: &armcompute.VirtualMachineProperties{
			HardwareProfile: &armcompute.HardwareProfile{
				VMSize: to.Ptr(armcompute.VirtualMachineSizeTypes(config.VMSize)),
			},
			StorageProfile: &armcompute.StorageProfile{
				ImageReference: &armcompute.ImageReference{
					ID: to.Ptr(vc.getImageID(config)),
				},
				OSDisk: &armcompute.OSDisk{
					Name:         to.Ptr(fmt.Sprintf("%s_OsDisk_1", config.VMName)),
					CreateOption: to.Ptr(armcompute.DiskCreateOptionTypesFromImage),
					Caching:      to.Ptr(armcompute.CachingTypesReadWrite),
					ManagedDisk: &armcompute.ManagedDiskParameters{
						StorageAccountType: to.Ptr(armcompute.StorageAccountTypesPremiumLRS),
					},
					DeleteOption: to.Ptr(armcompute.DiskDeleteOptionTypesDetach),
					DiskSizeGB:   to.Ptr[int32](200),
				},
				DataDisks: []*armcompute.DataDisk{},
			},
			OSProfile: &armcompute.OSProfile{
				ComputerName:  to.Ptr(config.VMName),
				AdminUsername: to.Ptr(config.AdminUsername),
				AdminPassword: to.Ptr(config.AdminPassword),
				LinuxConfiguration: &armcompute.LinuxConfiguration{
					DisablePasswordAuthentication: to.Ptr(false),
					ProvisionVMAgent:             to.Ptr(true),
					PatchSettings: &armcompute.LinuxPatchSettings{
						PatchMode:      to.Ptr(armcompute.LinuxVMGuestPatchModeImageDefault),
						AssessmentMode: to.Ptr(armcompute.LinuxPatchAssessmentModeImageDefault),
					},
				},
			},
			SecurityProfile: &armcompute.SecurityProfile{
				UefiSettings: &armcompute.UefiSettings{
					SecureBootEnabled: to.Ptr(true),
					VTpmEnabled:       to.Ptr(true),
				},
				SecurityType: to.Ptr(armcompute.SecurityTypesTrustedLaunch),
			},
			NetworkProfile: &armcompute.NetworkProfile{
				NetworkInterfaces: []*armcompute.NetworkInterfaceReference{
					{
						ID: to.Ptr(nicID),
						Properties: &armcompute.NetworkInterfaceReferenceProperties{
							DeleteOption: to.Ptr(armcompute.DeleteOptionsDelete),
						},
					},
				},
			},
			DiagnosticsProfile: &armcompute.DiagnosticsProfile{
				BootDiagnostics: &armcompute.BootDiagnostics{
					Enabled: to.Ptr(true),
				},
			},
			AdditionalCapabilities: &armcompute.AdditionalCapabilities{
				HibernationEnabled: to.Ptr(false),
			},
		},
	}

	// Start VM creation
	poller, err := vc.computeClient.BeginCreateOrUpdate(
		vc.ctx,
		config.ResourceGroupName,
		config.VMName,
		vm,
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed to start VM creation: %w", err)
	}

	// Wait for completion
	fmt.Println("⏳ Waiting for VM creation to complete...")
	_, err = poller.PollUntilDone(vc.ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to complete VM creation: %w", err)
	}

	return nil
}

func (vc *VMCreator) createNetworkInterface(config VMConfig, nicName string) (string, error) {
	// Get subnet ID
	subnetResp, err := vc.subnetClient.Get(
		vc.ctx,
		config.ResourceGroupName,
		config.VnetName,
		config.SubnetName,
		nil,
	)
	if err != nil {
		return "", fmt.Errorf("failed to get subnet: %w", err)
	}

	// Create network interface
	nic := armnetwork.Interface{
		Location: to.Ptr(config.Location),
		Properties: &armnetwork.InterfacePropertiesFormat{
			IPConfigurations: []*armnetwork.InterfaceIPConfiguration{
				{
					Name: to.Ptr("ipconfig1"),
					Properties: &armnetwork.InterfaceIPConfigurationPropertiesFormat{
						Subnet: &armnetwork.Subnet{
							ID: subnetResp.ID,
						},
						PrivateIPAllocationMethod: to.Ptr(armnetwork.IPAllocationMethodDynamic),
					},
				},
			},
		},
	}

	poller, err := vc.networkClient.BeginCreateOrUpdate(
		vc.ctx,
		config.ResourceGroupName,
		nicName,
		nic,
		nil,
	)
	if err != nil {
		return "", fmt.Errorf("failed to start NIC creation: %w", err)
	}

	resp, err := poller.PollUntilDone(vc.ctx, nil)
	if err != nil {
		return "", fmt.Errorf("failed to complete NIC creation: %w", err)
	}

	return *resp.ID, nil
}

func (vc *VMCreator) getImageID(config VMConfig) string {
	// Construct image ID based on the pattern from your example
	var imageName string
	if config.VMType == "control-plane" {
		imageName = "ndm-control-plane"
	} else {
		imageName = "ndm-worker"
	}

	return fmt.Sprintf(
		"/subscriptions/%s/resourceGroups/%s/providers/Microsoft.Compute/galleries/datamigrator/images/%s/versions/%s",
		config.SubscriptionID,
		config.ResourceGroupName,
		imageName,
		config.ImageVersion,
	)
}

func GetVMSize(vmType string) string {
	switch vmType {
	case "control-plane":
		return "Standard_D8s_v3" // Same as your example
	case "worker":
		return "Standard_D4s_v3" // Smaller for worker nodes
	default:
		return "Standard_D4s_v3"
	}
}
