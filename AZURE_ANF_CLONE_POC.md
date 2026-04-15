# Azure NetApp Files Clone POC

## Goal

Validate whether Azure NetApp Files (ANF) volume cloning works for our use case before wiring it into E2E tests.

## Conclusion

The POC succeeded.

Azure NetApp Files cloning is snapshot-based, not direct live-volume cloning. The working flow is:

`source volume -> snapshot -> restore to new volume`

## Source Volume Used

- Subscription: `MigrationAsAService-dev`
- Subscription ID: `1630c6a9-d99b-498a-aca8-a271f7506bc0`
- Resource group: `MigrationAsAService-dev-infra`
- Region: `eastus2`
- NetApp account: `Automation`
- Capacity pool: `automation_anf_pool1`
- Source volume: `volSrcAuto`
- Source mount path: `172.30.202.21:/volSrcAuto`
- Protocol: `NFSv3`
- Quota: `50 GiB`
- Subnet: `MigrationAsAService-dev-VNET01/MigrationAsAService-dev-Subnet02`

## Why Snapshot Was Needed

For Azure NetApp Files, clone creation is done by restoring a snapshot to a new volume. There is no direct "clone live volume" flow used here.

## Preparation

Azure CLI was available locally, but the default CLI config location under `~/.azure` hit a permissions issue in this environment. To avoid that, a workspace-local Azure CLI config directory was used.

Commands used:

```bash
mkdir -p "/Users/sr74813/codeBase/.azure-cli-tmp"
AZURE_CONFIG_DIR="/Users/sr74813/codeBase/.azure-cli-tmp" az login
AZURE_CONFIG_DIR="/Users/sr74813/codeBase/.azure-cli-tmp" az account set --subscription "1630c6a9-d99b-498a-aca8-a271f7506bc0"
```

## Checks Performed

### 1. Verify Azure login and selected subscription

```bash
AZURE_CONFIG_DIR="/Users/sr74813/codeBase/.azure-cli-tmp" \
az account show --subscription "1630c6a9-d99b-498a-aca8-a271f7506bc0"
```

Result:

- Azure login worked
- Active subscription was `MigrationAsAService-dev`

### 2. Inspect the source ANF volume

```bash
AZURE_CONFIG_DIR="/Users/sr74813/codeBase/.azure-cli-tmp" \
az netappfiles volume show \
  --resource-group "MigrationAsAService-dev-infra" \
  --account-name "Automation" \
  --pool-name "automation_anf_pool1" \
  --volume-name "volSrcAuto"
```

Important values confirmed from the source volume:

- `creationToken`: `volSrcAuto`
- `protocolTypes`: `NFSv3`
- `serviceLevel`: `Standard`
- `usageThreshold`: `53687091200` bytes (`50 GiB`)
- `subnetId`: `/subscriptions/1630c6a9-d99b-498a-aca8-a271f7506bc0/resourceGroups/MigrationAsAService-dev-infra/providers/Microsoft.Network/virtualNetworks/MigrationAsAService-dev-VNET01/subnets/MigrationAsAService-dev-Subnet02`
- Export policy allowed `0.0.0.0/0`
- Unix permissions: `0777`

### 3. Confirm no snapshots existed on the source volume

```bash
AZURE_CONFIG_DIR="/Users/sr74813/codeBase/.azure-cli-tmp" \
az netappfiles snapshot list \
  --resource-group "MigrationAsAService-dev-infra" \
  --account-name "Automation" \
  --pool-name "automation_anf_pool1" \
  --volume-name "volSrcAuto"
```

Result:

- Returned `[]`
- No snapshots existed initially

## POC Execution

Temporary timestamp used:

- `20260330082611`

Temporary resource names:

- Snapshot: `poc-snap-20260330082611`
- Clone volume: `poc-clone-20260330082611`

### 4. Create a temporary snapshot of the source volume

```bash
AZURE_CONFIG_DIR="/Users/sr74813/codeBase/.azure-cli-tmp" \
az netappfiles snapshot create \
  --resource-group "MigrationAsAService-dev-infra" \
  --account-name "Automation" \
  --pool-name "automation_anf_pool1" \
  --volume-name "volSrcAuto" \
  --name "poc-snap-20260330082611" \
  --location "eastus2"
```

Result:

- Snapshot provisioning state: `Succeeded`
- Snapshot ID:

```text
/subscriptions/1630c6a9-d99b-498a-aca8-a271f7506bc0/resourceGroups/MigrationAsAService-dev-infra/providers/Microsoft.NetApp/netAppAccounts/Automation/capacityPools/automation_anf_pool1/volumes/volSrcAuto/snapshots/poc-snap-20260330082611
```

### 5. Create the clone volume from the snapshot

The clone was created by restoring the snapshot to a new volume, while matching the source volume settings.

```bash
AZURE_CONFIG_DIR="/Users/sr74813/codeBase/.azure-cli-tmp" \
az netappfiles volume create \
  --resource-group "MigrationAsAService-dev-infra" \
  --account-name "Automation" \
  --pool-name "automation_anf_pool1" \
  --name "poc-clone-20260330082611" \
  --location "eastus2" \
  --service-level "Standard" \
  --usage-threshold 50 \
  --file-path "poc-clone-20260330082611" \
  --protocol-types NFSv3 \
  --vnet "MigrationAsAService-dev-VNET01" \
  --subnet-id "/subscriptions/1630c6a9-d99b-498a-aca8-a271f7506bc0/resourceGroups/MigrationAsAService-dev-infra/providers/Microsoft.Network/virtualNetworks/MigrationAsAService-dev-VNET01/subnets/MigrationAsAService-dev-Subnet02" \
  --security-style unix \
  --unix-permissions 0777 \
  --network-features Standard \
  --rules '[{"allowed_clients":"0.0.0.0/0","rule_index":"1","unix_read_only":"false","unix_read_write":"true","cifs":"false","nfsv3":"true","nfsv41":"false"}]' \
  --snapshot-id "/subscriptions/1630c6a9-d99b-498a-aca8-a271f7506bc0/resourceGroups/MigrationAsAService-dev-infra/providers/Microsoft.NetApp/netAppAccounts/Automation/capacityPools/automation_anf_pool1/volumes/volSrcAuto/snapshots/poc-snap-20260330082611" \
  --no-wait
```

The clone status was then polled until it reached `Succeeded`.

### 6. Verify the clone volume

Verification command used:

```bash
AZURE_CONFIG_DIR="/Users/sr74813/codeBase/.azure-cli-tmp" \
az netappfiles volume show \
  --resource-group "MigrationAsAService-dev-infra" \
  --account-name "Automation" \
  --pool-name "automation_anf_pool1" \
  --volume-name "poc-clone-20260330082611"
```

Verified result:

- Clone name: `Automation/automation_anf_pool1/poc-clone-20260330082611`
- Provisioning state: `Succeeded`
- Protocol: `NFSv3`
- Service level: `Standard`
- Quota: `50 GiB`
- Creation token: `poc-clone-20260330082611`

Expected mount path:

```text
172.30.202.21:/poc-clone-20260330082611
```

## Temporary Resources Currently Created

- Snapshot: `poc-snap-20260330082611`
- Clone volume: `poc-clone-20260330082611`

## Billing Notes

Azure NetApp Files billing is centered on the capacity pool.

- Creating a NetApp account by itself is not the main storage billing unit.
- Creating a capacity pool is billable, even if no volume is created inside it yet.
- Creating a volume does not usually create a separate storage service charge outside the pool. The volume quota is allocated from the pool.
- Snapshot usage is charged against the parent volume quota and uses the same billing rate as the pool's service level.

### Standard Pricing Details

- `Standard Storage` is priced on provisioned ANF capacity.
- `Standard Storage` single encryption: `$0.14746/GiB/month`
- For a `1 TiB` Standard pool, cost is about `$151.00/month`.
- Reserved capacity is available for regular ANF storage tiers, including `Standard Storage`, on the pricing page.
- In this POC, the `automation_anf_pool1` pool is a regular `Standard` pool, so the main cost driver is the `1 TiB` provisioned pool itself.
- Volumes such as `volSrcAuto` and `poc-clone-20260330082611` consume quota inside that already billable pool; they do not create a separate second storage service outside the pool.

### Elastic Pricing Details

- Azure pricing lists `Elastic Zone-Redundant Storage (Public Preview)` separately from the regular ANF tiers.
- Elastic pricing is shown as `Elastic Storage (Preview)` with zonal redundancy pricing.
- `Elastic Storage (Preview)` zonal redundancy single encryption: `$0.29419/GiB/month`
- For a `1 TiB` Elastic pool, cost is about `$301.25/month`.
- Elastic volumes can be much smaller than regular ANF volumes, but they still live inside the billable Elastic pool.

### Capacity Pool And Volume Charge Summary

- Capacity pool charge: this is the primary ANF storage charge. Azure bills provisioned ANF capacity by the hour.
- Volume charge: a volume is allocated quota from the capacity pool. It does not normally create a separate standalone storage service charge outside that pool.
- Snapshot charge: snapshots are charged within the parent volume and pool consumption model, based on incremental snapshot data.

### Useful References

- Microsoft Learn cost model: [Cost model for Azure NetApp Files](https://learn.microsoft.com/en-us/azure/azure-netapp-files/azure-netapp-files-cost-model)
- Microsoft pricing page: [Azure NetApp Files pricing](https://azure.microsoft.com/en-gb/pricing/details/netapp/)
- Service levels, including Elastic: [Service levels for Azure NetApp Files](https://learn.microsoft.com/en-us/azure/azure-netapp-files/azure-netapp-files-service-levels)
- Elastic overview: [Understand Azure NetApp Files Elastic zone-redundant storage service level](https://learn.microsoft.com/en-us/azure/azure-netapp-files/elastic-zone-redundant-concept)
- Elastic capacity pools: [Create a capacity pool for Elastic zone-redundant service](https://learn.microsoft.com/en-us/azure/azure-netapp-files/elastic-capacity-pool-task)

## E2E Clone Usage Table

Runtime clone names are generated dynamically with this pattern:

`<master-volume>_<test-case-prefix>_<8-char-uuid>`

Important note:

- For `NFS`, the helper creates `5` clones per setup call: `3` source + `2` destination.
- For `SMB`, the helper creates `7` clones per setup call: `4` source + `3` destination.
- Some tests only use a subset of the created clones.
- `Ordered` suites such as `TC-SUPPORT-BUNDLE` and `GCNV-Flex` create clones once per suite in `BeforeAll`.
- Total actively used clones across the table: `61`
- Total clones created across the table: `103`
- At `50 GiB` per clone, one full E2E run needs about `3050 GiB`, which is approximately `2.98 TiB` of actively used volume quota.

| Test case | Protocol | Clones created | Clones actively used | Base volumes used | Cloned but not used |
| --- | --- | --- | --- | --- | --- |
| `TC-001` | `NFS` | 5 | 4 | `master_nfs_vol_dnd_src_automation_1`, `master_nfs_vol_dnd_src_automation_2`, `master_nfs_vol_dnd_dest_automation_1`, `master_nfs_vol_dnd_dest_automation_2` | `master_nfs_vol_dnd_src_automation_3` |
| `TC-001` | `SMB` | 7 | 4 | `master_smb_vol_dnd_src_automation_1`, `master_smb_vol_dnd_src_automation_2`, `master_smb_vol_dnd_dest_automation_1`, `master_smb_vol_dnd_dest_automation_2` | `master_smb_vol_dnd_src_automation_3`, `master_smb_vol_dnd_src_automation_4_perms1`, `master_smb_vol_dnd_dest_automation_3_perms2` |
| `TC-002` | `NFS` | 5 | 4 | `master_nfs_vol_dnd_src_automation_1`, `master_nfs_vol_dnd_src_automation_2`, `master_nfs_vol_dnd_dest_automation_1`, `master_nfs_vol_dnd_dest_automation_2` | `master_nfs_vol_dnd_src_automation_3` |
| `TC-002` | `SMB` | 7 | 4 | `master_smb_vol_dnd_src_automation_1`, `master_smb_vol_dnd_src_automation_2`, `master_smb_vol_dnd_dest_automation_1`, `master_smb_vol_dnd_dest_automation_2` | `master_smb_vol_dnd_src_automation_3`, `master_smb_vol_dnd_src_automation_4_perms1`, `master_smb_vol_dnd_dest_automation_3_perms2` |
| `TC-003` | `NFS` | 5 | 4 | `master_nfs_vol_dnd_src_automation_1`, `master_nfs_vol_dnd_src_automation_2`, `master_nfs_vol_dnd_dest_automation_1`, `master_nfs_vol_dnd_dest_automation_2` | `master_nfs_vol_dnd_src_automation_3` |
| `TC-003` | `SMB` | 7 | 4 | `master_smb_vol_dnd_src_automation_1`, `master_smb_vol_dnd_src_automation_2`, `master_smb_vol_dnd_dest_automation_1`, `master_smb_vol_dnd_dest_automation_2` | `master_smb_vol_dnd_src_automation_3`, `master_smb_vol_dnd_src_automation_4_perms1`, `master_smb_vol_dnd_dest_automation_3_perms2` |
| `TC-004` | `NFS` | 5 | 4 | `master_nfs_vol_dnd_src_automation_1`, `master_nfs_vol_dnd_src_automation_2`, `master_nfs_vol_dnd_dest_automation_1`, `master_nfs_vol_dnd_dest_automation_2` | `master_nfs_vol_dnd_src_automation_3` |
| `TC-004` | `SMB` | 7 | 4 | `master_smb_vol_dnd_src_automation_1`, `master_smb_vol_dnd_src_automation_2`, `master_smb_vol_dnd_dest_automation_1`, `master_smb_vol_dnd_dest_automation_2` | `master_smb_vol_dnd_src_automation_3`, `master_smb_vol_dnd_src_automation_4_perms1`, `master_smb_vol_dnd_dest_automation_3_perms2` |
| `TC-005` | `NFS only` | 5 | 4 | `master_nfs_vol_dnd_src_automation_1`, `master_nfs_vol_dnd_src_automation_2`, `master_nfs_vol_dnd_dest_automation_1`, `master_nfs_vol_dnd_dest_automation_2` | `master_nfs_vol_dnd_src_automation_3` |
| `TC-006` | `NFS` | 5 | 4 | `master_nfs_vol_dnd_src_automation_1`, `master_nfs_vol_dnd_src_automation_2`, `master_nfs_vol_dnd_dest_automation_1`, `master_nfs_vol_dnd_dest_automation_2` | `master_nfs_vol_dnd_src_automation_3` |
| `TC-006` | `SMB` | 7 | 4 | `master_smb_vol_dnd_src_automation_1`, `master_smb_vol_dnd_src_automation_2`, `master_smb_vol_dnd_dest_automation_1`, `master_smb_vol_dnd_dest_automation_2` | `master_smb_vol_dnd_src_automation_3`, `master_smb_vol_dnd_src_automation_4_perms1`, `master_smb_vol_dnd_dest_automation_3_perms2` |
| `TC-SUPPORT-BUNDLE` | `NFS` | 5 per suite | 4 | `master_nfs_vol_dnd_src_automation_1`, `master_nfs_vol_dnd_src_automation_2`, `master_nfs_vol_dnd_dest_automation_1`, `master_nfs_vol_dnd_dest_automation_2` | `master_nfs_vol_dnd_src_automation_3` |
| `TC-SUPPORT-BUNDLE` | `SMB` | 7 per suite | 4 | `master_smb_vol_dnd_src_automation_1`, `master_smb_vol_dnd_src_automation_2`, `master_smb_vol_dnd_dest_automation_1`, `master_smb_vol_dnd_dest_automation_2` | `master_smb_vol_dnd_src_automation_3`, `master_smb_vol_dnd_src_automation_4_perms1`, `master_smb_vol_dnd_dest_automation_3_perms2` |
| `GCNV-Flex` | `NFS only` | 5 per suite | 3 | `master_nfs_vol_dnd_src_automation_1`, `master_nfs_vol_dnd_src_automation_2`, `master_nfs_vol_dnd_dest_automation_2` | `master_nfs_vol_dnd_src_automation_3`, `master_nfs_vol_dnd_dest_automation_1` |
| `TC-SMB-PERMISSIONS-001` | `SMB only` | 7 | 2 | `master_smb_vol_dnd_src_automation_4_perms1`, `master_smb_vol_dnd_dest_automation_3_perms2` | `master_smb_vol_dnd_src_automation_1`, `master_smb_vol_dnd_src_automation_2`, `master_smb_vol_dnd_src_automation_3`, `master_smb_vol_dnd_dest_automation_1`, `master_smb_vol_dnd_dest_automation_2` |
| `TC-SMB-PERMISSIONS-002` | `SMB only` | 7 | 2 | `master_smb_vol_dnd_src_automation_4_perms1`, `master_smb_vol_dnd_dest_automation_3_perms2` | `master_smb_vol_dnd_src_automation_1`, `master_smb_vol_dnd_src_automation_2`, `master_smb_vol_dnd_src_automation_3`, `master_smb_vol_dnd_dest_automation_1`, `master_smb_vol_dnd_dest_automation_2` |
| `TC-SMB-PERMISSIONS-003` | `SMB only` | 7 | 2 | `master_smb_vol_dnd_src_automation_4_perms1`, `master_smb_vol_dnd_dest_automation_3_perms2` | `master_smb_vol_dnd_src_automation_1`, `master_smb_vol_dnd_src_automation_2`, `master_smb_vol_dnd_src_automation_3`, `master_smb_vol_dnd_dest_automation_1`, `master_smb_vol_dnd_dest_automation_2` |
| `TC-SMB-REDIRECTS` | `SMB only` | 0 | 0 | Uses `AD_SMB_SOURCE_VOLUMES[0]` directly, no clone | `None` |
| `TC-SMB-RESTRICTED-ACCESS` | `SMB only` | 0 | 0 | Uses `AD_SMB_SOURCE_VOLUMES[1]` directly, no clone | `None` |

