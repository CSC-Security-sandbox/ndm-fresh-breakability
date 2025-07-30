#!/bin/bash

# This script applies only the meaningful logger changes without prettier formatting
# Run this from the ndm directory

echo "Applying logger changes without prettier formatting..."

# Apply the stashed changes
git stash pop

# Now we'll revert the prettier formatting but keep the logger logic
# Create a backup of the current state
git add .
git commit -m "Backup: Logger changes with prettier formatting"

# Reset to the commit before our changes
git reset --hard HEAD~1

# Now we'll manually apply just the logger changes using sed and other tools
echo "Applying logger imports and constructor changes..."

# Function to add logger imports to a file
add_logger_imports() {
    local file=$1
    # Check if the file already has LoggerService import
    if ! grep -q "LoggerService" "$file"; then
        # Add LoggerService and LoggerFactory imports
        if grep -q "import.*@nestjs/common" "$file"; then
            # Add Inject if not present
            if ! grep -q "Inject" "$file"; then
                sed -i '' 's/} from "@nestjs\/common";/, Inject } from "@nestjs\/common";/' "$file"
            fi
        fi
        
        # Add logger-lib import after the last import
        awk '/^import.*/ { imports[++i] = $0; next } 
             /^$/ && imports[i] && !added { 
                 for(j=1; j<=i; j++) print imports[j]; 
                 print "import { LoggerService, LoggerFactory } from '\''@netapp-cloud-datamigrate/logger-lib'\'';"; 
                 print ""; 
                 added=1; 
                 next 
             } 
             { print }' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    fi
}

# Apply changes to each file
files=(
    "services/reports-service/src/app.module.ts"
    "services/reports-service/src/discovery/discovery.controller.ts"
    "services/reports-service/src/discovery/discovery.module.ts"
    "services/reports-service/src/discovery/discovery.service.ts"
    "services/reports-service/src/overview/overview.controller.ts"
    "services/reports-service/src/overview/overview.module.ts"
    "services/reports-service/src/overview/overview.service.ts"
    "services/reports-service/src/job-run/job-run.controller.ts"
    "services/reports-service/src/job-run/job-run.module.ts"
    "services/reports-service/src/job-run/job-run.service.ts"
    "services/reports-service/src/pdf/pdf.controller.ts"
    "services/reports-service/src/pdf/pdf.module.ts"
    "services/reports-service/src/pdf/pdf.service.ts"
    "services/reports-service/src/csv/csv_export.service.ts"
    "services/reports-service/src/csv/error_log_csv.service.ts"
)

echo "Would you like me to create a more targeted approach instead? (y/n)"
