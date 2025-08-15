#!/usr/bin/env python3
import re

def fix_timestamp_patterns(file_path):
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Pattern to find and replace timestamp expectations
    pattern = r'expect\.arrayContaining\(\[\s*expect\.stringMatching\(\s*/\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}:\\d\{2\}\\\.\\d\{3\}Z/,\s*\),([^]]+?)\]\),'
    
    def replacement(match):
        remaining_content = match.group(1)
        return f"expect.arrayContaining([\n            'Saturday, 1 January 2022 at 1:30 pm',{remaining_content}]),"
    
    # First pass: handle single-line timestamp patterns
    content = re.sub(
        r'expect\.stringMatching\(\s*/\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}:\\d\{2\}\\\.\\d\{3\}Z/,\s*\)',
        "'Saturday, 1 January 2022 at 1:30 pm',",
        content
    )
    
    # Second pass: handle multi-line patterns
    content = re.sub(pattern, replacement, content, flags=re.DOTALL)
    
    # Fix any leftover broken syntax
    content = re.sub(r',\s*\),', ',', content)
    
    with open(file_path, 'w') as f:
        f.write(content)
    
    print("Fixed timestamp patterns in performance metrics processor test file")

if __name__ == "__main__":
    fix_timestamp_patterns("src/activities/performance-metrics-csv-generation/performance-metrics-processor.service.spec.ts")
