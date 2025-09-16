# Documentation Deployment Guide

## GitHub Pages Setup

The documentation is automatically deployed to GitHub Pages when changes are pushed to the main branch.

### Prerequisites

1. **Enable GitHub Pages** in your repository:
   - Go to Settings → Pages
   - Under "Source", select "GitHub Actions"
   - Save the changes

### Automatic Deployment

The documentation will automatically deploy when:
- Changes are pushed to the `main` branch
- Changes affect any of these paths:
  - `packages/docs/**`
  - `packages/core/**` 
  - `packages/react/**`
  - `.github/workflows/deploy-docs.yml`

### Manual Deployment

You can also trigger a manual deployment:
1. Go to Actions tab in GitHub
2. Select "Deploy Documentation to GitHub Pages"
3. Click "Run workflow"
4. Select the branch and click "Run workflow"

### Local Testing

To test the production build locally:

```bash
# Build the documentation
pnpm --filter @wizard/docs build

# The static files will be in packages/docs/out
# You can serve them locally with:
npx serve packages/docs/out
```

### Configuration

The deployment is configured in:
- `.github/workflows/deploy-docs.yml` - GitHub Actions workflow
- `packages/docs/next.config.mjs` - Next.js configuration with GitHub Pages support (automatically detects repository from GitHub Actions)
- `packages/docs/public/.nojekyll` - Tells GitHub Pages to not process with Jekyll

### Dynamic Configuration

The repository URL and base path are automatically detected from GitHub Actions environment variables:
- `GITHUB_REPOSITORY` - Provided by GitHub Actions (format: owner/repo)
- Base path is automatically set based on the repository name
- Works with both project pages (`username.github.io/repo`) and user/org pages (`username.github.io`)

### Access the Documentation

Once deployed, the documentation will be available at:
```
https://[username].github.io/[repository-name]/
```

The exact URL will be shown in the GitHub Actions workflow output under the deployment step.

### Troubleshooting

1. **404 Errors**: Make sure GitHub Pages is enabled and set to "GitHub Actions" source
2. **Assets not loading**: Check that basePath in next.config.mjs matches your repository name
3. **Build failures**: Check the Actions tab for error logs
4. **Deployment not triggering**: Ensure you're pushing to the main branch

### Notes

- The first deployment may take a few minutes to become available
- GitHub Pages caches aggressively, you may need to hard refresh (Ctrl+Shift+R) to see updates
- The workflow uses pnpm for faster builds
- Static export is enabled with `output: 'export'` in Next.js config