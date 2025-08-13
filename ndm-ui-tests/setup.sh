#!/bin/bash

# NetApp Data Migrator UI Tests - Quick Start Script

echo "🚀 NetApp Data Migrator UI Tests"
echo "================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "📦 Installing dependencies..."
npm install

echo "🌐 Installing Playwright browsers..."
npx playwright install

echo "✅ Setup complete!"
echo ""
echo "Available test commands:"
echo "  npm test                    - Run all tests"
echo "  npm run test:headed         - Run tests with browser UI"
echo "  npm run test:ui             - Run tests with Playwright UI"
echo "  npm run test:debug          - Debug tests"
echo "  npm run test:bulk-migration - Run bulk migration tests"
echo "  npm run test:file-server    - Run file server tests"
echo "  npm run test:job-management - Run job management tests"
echo "  npm run test:api            - Run API integration tests"
echo "  npm run test:smoke          - Run smoke tests"
echo ""
echo "📊 View test report:"
echo "  npm run test:report"
echo ""
echo "🔧 Make sure your NetApp Data Migrator application is running on http://localhost:3111"
echo ""
echo "To run your first test:"
echo "  npm run test:smoke"
