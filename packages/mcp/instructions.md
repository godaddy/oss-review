# OSS Readiness Review Instructions

This MCP server provides comprehensive tools and resources for evaluating open-source readiness, security posture, and compliance requirements before publishing repositories. It helps identify risks across secrets, licensing, security vulnerabilities, and policy violations.

When asked to perform an OSS readiness review, follow these steps:

## 1. Scan for Policy Violations
Run the `search` tool on the repository root to detect internal references, sensitive links, and other policy violations based on configured detection patterns.

## 2. Detect Leaked Secrets
Run the `secretlint` tool on the repository root to find hardcoded credentials, API keys, tokens, and other secrets that must be removed before release.

## 3. Audit License Compliance
Run the `licenses` tool to verify all dependencies use approved licenses. This generates an SBOM and checks against the configured license policy (green/yellow/red categories).

## 4. Check Security Vulnerabilities
Run the `security` tool to scan dependencies for known vulnerabilities using configured scanners (e.g., npm-audit).

## 5. Verify Required Documentation
List available resources via `entries` to see what documentation templates are available (LICENSE, SECURITY.md, etc.). Check if these files exist in the repository, use these resources if they are missing.

## 6. Report Findings
Summarize all issues found, organized by severity (critical/high/medium/low). Provide clear remediation guidance for each issue.

## Notes
- Always use absolute paths when calling tools
- For monorepos, scan each package directory individually
- Prioritize critical and high severity findings
