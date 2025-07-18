#!/bin/sh

# Usage:
# ./add_ovf_properties.sh OVF_EXPORT_PATH PRODUCT_NAME VERSION VCENTER_URL VCENTER_USER VCENTER_PASS VCENTER_INSECURE CONTENT_LIBRARY [OVFTOOL_PATH]

set -e

OVF_EXPORT_PATH="$1"
PRODUCT_NAME="$2"
VERSION="$3"
VCENTER_URL="$4"
VCENTER_USER="$5"
VCENTER_PASS="$6"
VCENTER_INSECURE="$7"
COMMON_CONTENT_LIBRARY_NAME="$8"
OVFTOOL_PATH="${9:-ovftool}"

cd "$OVF_EXPORT_PATH"
echo "------------------------------------------------------------"
echo "Working in directory: $OVF_EXPORT_PATH"
echo "------------------------------------------------------------"

VM_NAME="$(basename "$OVF_EXPORT_PATH")"
OVA_FILE="${VM_NAME}.ova"
CUSTOM_PRODUCT_XML="../../../ovf-customizer/templates/ProductSection.xml.template"
CUSTOM_EULA_XML="../../../ovf-customizer/templates/EulaSection.xml.template"

# 1. Untar OVA in a temp folder in OUTPUT_DIR
TMP_UNPACK_DIR="${OVF_EXPORT_PATH}/ovf_unpack_tmp.$$"
mkdir -p "$TMP_UNPACK_DIR"
tar -xvf "$OVA_FILE" -C "$TMP_UNPACK_DIR"
rm -f "$OVA_FILE"

# 2. Patch OVF file inside unpacked folder
OUTPUT_OVF=$(find "$TMP_UNPACK_DIR" -maxdepth 1 -type f -name '*.ovf' | head -n1)
DST_MF="${OUTPUT_OVF%.ovf}.mf"

echo "----- OVF before patching -----"
cat "$OUTPUT_OVF"
echo "------------------------------"

TMP_PRODUCT_XML="$(mktemp /tmp/product.XXXXXX.xml)"
TMP_EULA_XML="$(mktemp /tmp/eula.XXXXXX.xml)"
TMP_OVF="$(mktemp /tmp/ovf.XXXXXX.ovf)"

cp "$CUSTOM_PRODUCT_XML" "$TMP_PRODUCT_XML"
cp "$CUSTOM_EULA_XML" "$TMP_EULA_XML"

# Patch product info
if sed --version >/dev/null 2>&1; then
    SED_INPLACE="sed -i"
else
    SED_INPLACE="sed -i ''"
fi
$SED_INPLACE "s|\\PRODUCT_NAME|$PRODUCT_NAME|g; s|\\BUILD_VERSION|$VERSION|g" "$TMP_PRODUCT_XML"

awk -v prod="$TMP_PRODUCT_XML" -v eula="$TMP_EULA_XML" '
/<\/AnnotationSection>/ {
        print
        while ((getline l < prod) > 0) print l
        while ((getline l < eula) > 0) print l
        next
}
{ print }
' "$OUTPUT_OVF" > "$TMP_OVF"
mv "$TMP_OVF" "$OUTPUT_OVF"
rm -f "$TMP_PRODUCT_XML" "$TMP_EULA_XML"

# Ensure ovf:transport="com.vmware.guestInfo" is present on the VirtualHardwareSection
if grep -q '<VirtualHardwareSection' "$OUTPUT_OVF"; then
  $SED_INPLACE '/<VirtualHardwareSection/ s/<VirtualHardwareSection[^>]*/<VirtualHardwareSection ovf:transport="com.vmware.guestInfo"/' "$OUTPUT_OVF"
fi
echo "Patched OVF transport: ovf:transport=\"com.vmware.guestInfo\""

# Check if NVRAM is referenced in the OVF file
if grep -q 'vmw:key="nvram"' "$OUTPUT_OVF" || grep -q '\.nvram"' "$OUTPUT_OVF"; then
    # Remove <vmw:ExtraConfig ... vmw:key="nvram"...> lines
    $SED_INPLACE '/^[[:space:]]*<vmw:ExtraConfig[[:space:]]\+ovf:required="false"[[:space:]]\+vmw:key="nvram".*$/d' "$OUTPUT_OVF"

    # Remove <File ... .nvram ...> lines
    $SED_INPLACE "/^[[:space:]]*<File[[:space:]]\+ovf:href=.*\.nvram\".*$/d" "$OUTPUT_OVF"

    # Remove any .nvram file in unpacked folder (if present)
    find "$TMP_UNPACK_DIR" -maxdepth 1 -type f -name "*.nvram" -exec rm -f {} \;

    echo "Removed NVRAM references from OVF and deleted NVRAM files."
else
    echo "No NVRAM references found in OVF."
fi

echo "----- OVF after patching -----"
cat "$OUTPUT_OVF"
echo "-----------------------------"

echo "------------------------------------------------------------"
echo "OVF injection completed: $OUTPUT_OVF"
echo "------------------------------------------------------------"

# 3. Validate OVF
echo "Validating OVF file..."
"$OVFTOOL_PATH" --schemaValidate "$OUTPUT_OVF" >/dev/null && echo "OVF validation completed successfully."
echo "------------------------------------------------------------"

# 4. Remove any manifest file
echo "Removing any existing manifest file ($DST_MF)..."
rm -f "$DST_MF"
echo "------------------------------------------------------------"

# 5. Repackage as OVA with the SAME NAME as the original
echo "Converting OVF to OVA: $OVA_FILE (with SHA256 manifest using ovftool)"
"$OVFTOOL_PATH" --shaAlgorithm=SHA256 --skipManifestGeneration=false --skipManifestCheck=false --acceptAllEulas "$OUTPUT_OVF" "$OVA_FILE"
if [ $? -eq 0 ] && [ -f "$OVA_FILE" ]; then
    echo "OVA package created: $OVA_FILE"
else
    echo "OVA creation failed."
    rm -rf "$TMP_UNPACK_DIR"
    exit 1
fi
echo "------------------------------------------------------------"

# 6. Upload OVA to Content Library using govc library.import
echo "Uploading OVA to vSphere Content Library (govc library.import) ..."

export GOVC_URL="https://$VCENTER_URL"
export GOVC_USERNAME="$VCENTER_USER"
export GOVC_PASSWORD="$VCENTER_PASS"
export GOVC_INSECURE="$VCENTER_INSECURE"

govc library.import -m=true -t=ovf -a=SHA256 "$COMMON_CONTENT_LIBRARY_NAME" "$OVA_FILE"

if [ $? -eq 0 ]; then
    echo "OVA uploaded to content library: $COMMON_CONTENT_LIBRARY_NAME"
else
    echo "Failed to upload OVA to content library."
    rm -rf "$TMP_UNPACK_DIR"
    exit 1
fi
echo "------------------------------------------------------------"
echo "All steps completed."

# Cleanup temporary files and unpack dir
rm -rf "$TMP_UNPACK_DIR"
rm -f /tmp/product.*.xml /tmp/eula.*.xml /tmp/ovf.*.ovf
echo "Temporary files cleaned up."  
echo "------------------------------------------------------------"
