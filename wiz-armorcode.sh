#!/bin/bash
set -e

token=$1
filePath=$2
productName='NDM'
subProductName='Wiz'
environmentName="Staging"
toolName="Wiz"
urlUpload='https://netappcloud.armorcode.com/client/utils/scan/upload'
scanIdentifier=''
# Enter space separated strings of tags. e.g - tags=("key1:value1" "key2:value2")
tags=() 

if [ $# -ne 2 ]
then
  echo "invalid arguments, please specify token and filePath"
  echo "usage - ./<script> <token> <filePath>"
  exit -1
fi

echo "token: <redacted>"
echo "toolName: $toolName"
echo "productName: $productName"
echo "subProductName: $subProductName"
echo "environment: $environmentName"
echo "filePath: $filePath"
echo "urlUpload: $urlUpload"
echo "scanIdentifier: $scanIdentifier"
echo "tags: ${tags[@]}"

# Build JSON array manually
tags_json="["
for tag in "${tags[@]}"; do
  # Escape any double quotes (if present in future)
  tag_escaped=$(printf '%s' "$tag" | sed 's/"/\\"/g')
  tags_json+="\"$tag_escaped\","
done
# Remove the trailing comma and close the array
tags_json="${tags_json%,}]"

# Now echo the result
echo "tags_json: $tags_json"


echo "create scan entry in ArmorCode"
result=$(curl "$urlUpload" -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $token" --data-raw "{\"product\":\"$productName\",\"subProduct\":\"$subProductName\",\"env\":\"$environmentName\",\"scanTool\":\"$toolName\",\"fileName\":\"$filePath\",\"scanIdentifier\":\"$scanIdentifier\",\"tags\":$tags_json}")
echo "API response for Upload - $result"

errorMessage=$(echo $result | jq --raw-output '.message')
if [ -z "$errorMessage" ]
  then
    echo "Error Message - $errorMessage"
    exit 2
fi

signedUrl=$(echo $result | jq --raw-output '.signedUrl')
echo "signedUrl: $signedUrl"
echo "upload scanfile"
curl --upload-file "$filePath" -X PUT -L $signedUrl
echo "Scan upload to ArmorCode complete"
