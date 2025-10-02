#!/bin/bash
# Test script to demonstrate both wizard modes

echo "========================================"
echo "Testing Node Saga Wizard"
echo "========================================"
echo ""

echo "1. Testing Automated Mode..."
echo "   Running: pnpm start auto"
echo "----------------------------------------"
pnpm start auto

echo ""
echo ""
echo "========================================"
echo "2. Interactive Mode Information"
echo "========================================"
echo ""
echo "Interactive mode requires a real terminal (TTY)."
echo "To test it manually, run:"
echo ""
echo "  pnpm start"
echo ""
echo "Then follow the prompts to complete the wizard."
echo ""
echo "Note: Interactive mode will show a helpful error"
echo "if run without a TTY (like in CI/CD)."
echo ""
