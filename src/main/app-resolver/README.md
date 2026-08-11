# Smart App Resolution System

A intelligent application name resolution system that allows users to launch applications using natural language names instead of exact executable names.

## Overview

The Smart App Resolution system enhances the `start_app` tool by automatically resolving user-friendly application names (like "Chrome", "File Pilot", "VS Code") to their actual executable paths. It uses multiple resolution strategies in cascade, learns from user interactions, and provides suggestions when matches are ambiguous.

### Key Features

- **Multi-Strategy Resolution**: Tries multiple approaches to find the right application
- **Learning System**: Improves accuracy over time by learning from successful launches
- **Fuzzy Matching**: Finds applications even with typos or partial names
- **Windows Registry Integration**: Searches system-registered applications
- **Performance Optimized**: Aggressive caching for sub-500ms response times
- **Configurable**: Customize thresholds, strategies, and search directories

## How It Works

### Strategy Cascade

The system tries resolution strategies in this order, stopping when a high-confidence match is found:

1. **App Registry** (Confidence: 1.0)
   - Exact matches from predefined and learned mappings
   - Fastest lookup (< 10ms)
   - Case-insensitive alias matching

2. **Learning System** (Confidence: 0-0.95)
   - Mappings learned from successful launches
   - Confidence based on success rate: `successCount / (successCount + failureCount)`
   - Automatically promoted to App Registry after 3+ successful uses

3. **Fuzzy Matcher** (Confidence: 0-0.95)
   - Searches filesystem for .exe and .lnk files
   - Uses Levenshtein distance for similarity scoring
   - Handles spaces and partial matches
   - Cached for 24 hours

4. **Windows Registry** (Confidence: 0.7-0.9)
   - Queries system registry for installed applications
   - Searches `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths`
   - Searches `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
   - Cached for 1 hour

### Confidence Scoring

- **≥ 0.8**: High confidence - application launches immediately
- **0.5 - 0.8**: Ambiguous - user receives suggestions to choose from
- **< 0.5**: Low confidence - result not returned

## Usage Examples

### For Developers

#### Basic Usage

```typescript
import { AppResolver } from './app-resolver/AppResolver';
import { createDefaultConfig } from './app-resolver/config';

// Initialize resolver
const config = await createDefaultConfig();
const resolver = new AppResolver(config, ...components);

// Resolve an application
const result = await resolver.resolve('Chrome');

if (result.success && result.executablePath) {
  // Launch the application
  console.log(`Launching: ${result.executablePath}`);
  console.log(`Confidence: ${result.confidenceScore}`);
  console.log(`Strategy: ${result.strategy}`);
  
  // Report success for learning
  await resolver.reportSuccess('Chrome', result.executablePath);
} else if (result.suggestions) {
  // Multiple matches found
  console.log('Please select one:');
  result.suggestions.forEach((s, i) => {
    console.log(`${i + 1}. ${s.name} (${s.confidenceScore.toFixed(2)})`);
  });
}
```

#### Handling Ambiguous Results

```typescript
const result = await resolver.resolve('code');

if (!result.success && result.suggestions) {
  // Present suggestions to user
  const suggestions = result.suggestions.map((s, i) => ({
    index: i + 1,
    name: s.name,
    path: s.executablePath,
    confidence: s.confidenceScore.toFixed(2),
    source: s.source
  }));
  
  // User selects option 1
  const selected = suggestions[0];
  await resolver.reportSuccess('code', selected.path);
}
```

#### Reporting Failures

```typescript
const result = await resolver.resolve('myapp');

if (result.success) {
  try {
    await launchApp(result.executablePath);
    await resolver.reportSuccess('myapp', result.executablePath);
  } catch (error) {
    // Launch failed - report to learning system
    await resolver.reportFailure('myapp', result.executablePath);
  }
}
```

### For AI Function Calling

The system integrates seamlessly with the `start_app` tool:

```typescript
// AI calls: start_app("File Pilot")
// System resolves "File Pilot" -> "C:\Program Files\FilePilot\filepilot.exe"
// Application launches successfully

// AI calls: start_app("code editor")
// System returns suggestions:
// 1. Visual Studio Code (0.85)
// 2. Notepad++ (0.72)
// 3. Sublime Text (0.68)
// AI presents options to user
```

## Configuration

### Configuration File

The system reads configuration from `app-resolver-config.json` in the app's userData directory:

```json
{
  "confidenceThreshold": 0.8,
  "ambiguousThreshold": 0.5,
  "maxSuggestions": 5,
  "enabledStrategies": [
    "app_registry",
    "learning_system",
    "fuzzy_matcher",
    "windows_registry"
  ],
  "customSearchDirs": [
    "C:\\CustomApps",
    "D:\\PortableApps"
  ],
  "cacheConfig": {
    "fuzzyMatchTTL": 86400000,
    "registryTTL": 3600000,
    "maxCacheSize": 1000
  },
  "searchDirs": [
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs",
    "%LOCALAPPDATA%\\Programs"
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `confidenceThreshold` | number | 0.8 | Minimum confidence for automatic launch |
| `ambiguousThreshold` | number | 0.5 | Minimum confidence to include in suggestions |
| `maxSuggestions` | number | 5 | Maximum number of suggestions to return |
| `enabledStrategies` | string[] | all | Which resolution strategies to use |
| `customSearchDirs` | string[] | [] | Additional directories to search for apps |
| `cacheConfig.fuzzyMatchTTL` | number | 86400000 | Fuzzy match cache TTL (24h in ms) |
| `cacheConfig.registryTTL` | number | 3600000 | Registry cache TTL (1h in ms) |
| `cacheConfig.maxCacheSize` | number | 1000 | Maximum cache entries |
| `searchDirs` | string[] | standard | Directories to search for applications |

### Customizing Strategies

Disable specific strategies if needed:

```json
{
  "enabledStrategies": [
    "app_registry",
    "learning_system"
  ]
}
```

This configuration skips fuzzy matching and registry search, using only exact matches and learned mappings.

### Adding Custom Search Directories

```json
{
  "customSearchDirs": [
    "D:\\PortableApps",
    "E:\\Games",
    "C:\\Tools"
  ]
}
```

The fuzzy matcher will search these directories in addition to standard Windows locations.

## Predefined Application Mappings

The system includes predefined mappings for 40+ common applications:

### Web Browsers
- **Chrome**: `chrome`, `google chrome`, `browser`, `google`
- **Firefox**: `firefox`, `mozilla firefox`, `mozilla`, `ff`
- **Edge**: `edge`, `microsoft edge`, `msedge`
- **Opera**: `opera`, `opera browser`
- **Brave**: `brave`, `brave browser`

### Code Editors & IDEs
- **VS Code**: `vscode`, `vs code`, `code`, `visual studio code`
- **Notepad++**: `notepad++`, `notepadplusplus`, `npp`
- **Sublime Text**: `sublime`, `sublime text`, `subl`
- **Visual Studio**: `visual studio`, `vs`, `vstudio`
- **IntelliJ IDEA**: `intellij`, `idea`, `intellij idea`

### File Managers
- **File Pilot**: `filepilot`, `file pilot`, `pilot`
- **Total Commander**: `total commander`, `totalcmd`, `tc`

### Communication
- **Discord**: `discord`
- **Slack**: `slack`
- **Teams**: `teams`, `microsoft teams`, `ms teams`
- **Zoom**: `zoom`, `zoom meetings`

### Productivity
- **Word**: `word`, `microsoft word`, `ms word`, `winword`
- **Excel**: `excel`, `microsoft excel`, `ms excel`
- **PowerPoint**: `powerpoint`, `microsoft powerpoint`, `ppt`
- **Adobe Reader**: `acrobat`, `adobe reader`, `pdf reader`

### Development Tools
- **Git Bash**: `git bash`, `gitbash`, `bash`
- **Windows Terminal**: `terminal`, `windows terminal`, `wt`
- **PowerShell**: `powershell`, `pwsh`, `ps`
- **Docker**: `docker`, `docker desktop`
- **Postman**: `postman`

### System Utilities
- **Notepad**: `notepad`
- **Calculator**: `calculator`, `calc`
- **Paint**: `paint`, `mspaint`
- **7-Zip**: `7zip`, `7-zip`, `sevenzip`
- **WinRAR**: `winrar`, `rar`

See `predefinedApps.ts` for the complete list and installation paths.

## Learning System

### How Learning Works

1. **Recording Success**: When an application launches successfully, the mapping is recorded
2. **Confidence Building**: Each successful use increases the confidence score
3. **Promotion**: After 3 successful uses, the mapping is promoted to App Registry
4. **Failure Tracking**: Failed launches decrease confidence
5. **Cleanup**: Mappings unused for 90+ days are automatically removed

### Learning Data Storage

Stored in `learning-data.json`:

```json
{
  "version": "1.0.0",
  "entries": [
    {
      "userInput": "my custom app",
      "executablePath": "C:\\Apps\\MyApp\\app.exe",
      "successCount": 5,
      "failureCount": 0,
      "firstSeen": "2024-01-10T12:00:00Z",
      "lastUsed": "2024-01-20T09:15:00Z",
      "promoted": true
    }
  ]
}
```

### Confidence Score Formula

```
confidence = min(successCount / (successCount + failureCount), 0.95)
```

Examples:
- 3 successes, 0 failures: 0.95 (capped)
- 5 successes, 1 failure: 0.83
- 2 successes, 2 failures: 0.50

## Performance Considerations

### Performance Targets

| Operation | Target | Typical |
|-----------|--------|---------|
| Registry lookup | < 10ms | ~5ms |
| Learning lookup | < 20ms | ~10ms |
| Fuzzy search (cached) | < 50ms | ~30ms |
| Fuzzy search (cold) | < 2s | ~1.5s |
| Windows Registry | < 1s | ~500ms |
| Full resolution | < 500ms | ~200ms |

### Caching Strategy

1. **In-Memory Cache**: LRU cache with configurable TTL
2. **Persistent Storage**: App Registry and Learning Data
3. **Cache Warming**: Preload frequent apps at startup
4. **Background Rebuild**: Index updates don't block requests

### Optimization Tips

1. **Disable Unused Strategies**: If you don't need fuzzy matching, disable it
2. **Limit Search Directories**: Fewer directories = faster fuzzy search
3. **Increase Cache TTL**: Longer TTL = fewer filesystem scans
4. **Preload Common Apps**: Add frequently used apps to predefined mappings

## Troubleshooting

### Application Not Found

**Problem**: System can't find an installed application

**Solutions**:
1. Check if the application is in standard installation directories
2. Add the application's directory to `customSearchDirs`
3. Manually add to App Registry:
   ```typescript
   await registry.addEntry({
     aliases: ['myapp', 'my application'],
     executablePath: 'C:\\Path\\To\\app.exe',
     displayName: 'My Application',
     addedAt: new Date(),
     source: 'predefined',
     usageCount: 0,
     lastUsed: new Date()
   });
   ```

### Wrong Application Launches

**Problem**: System launches the wrong application

**Solutions**:
1. Report the failure: `await resolver.reportFailure(input, wrongPath)`
2. Use a more specific name (e.g., "vscode" instead of "code")
3. Check App Registry for conflicting aliases
4. Clear learning data if incorrect mappings were learned

### Slow Resolution

**Problem**: Resolution takes too long

**Solutions**:
1. Check cache configuration - increase TTL values
2. Reduce number of `searchDirs`
3. Disable `fuzzy_matcher` strategy if not needed
4. Check if filesystem is slow (network drives, etc.)
5. Increase `maxCacheSize` for more caching

### Ambiguous Results

**Problem**: System always returns multiple suggestions

**Solutions**:
1. Lower `confidenceThreshold` (e.g., 0.7 instead of 0.8)
2. Use more specific application names
3. Add exact aliases to App Registry
4. Let the learning system build confidence over time

### Cache Issues

**Problem**: Stale results or outdated application paths

**Solutions**:
1. Clear cache: Delete cache entries or restart application
2. Reduce cache TTL values
3. Run `validateEntries()` to remove invalid paths
4. Check if applications were moved or uninstalled

### Configuration Not Loading

**Problem**: Custom configuration is ignored

**Solutions**:
1. Check JSON syntax - must be valid JSON
2. Verify file location: `app.getPath('userData')/app-resolver-config.json`
3. Check console for configuration errors
4. System falls back to defaults on invalid config

## File Structure

```
src/main/app-resolver/
├── README.md                      # This file
├── types.ts                       # TypeScript interfaces and types
├── AppResolver.ts                 # Main orchestrator
├── AppRegistry.ts                 # Static mappings database
├── LearningSystem.ts              # Adaptive learning component
├── FuzzyMatcher.ts                # Filesystem search with fuzzy matching
├── WindowsRegistrySearcher.ts    # Windows Registry integration
├── CacheManager.ts                # LRU cache with TTL
├── predefinedApps.ts              # Predefined application mappings
├── *.test.ts                      # Unit tests
└── integration.test.ts            # Integration tests
```

## Data Storage

All data is stored in the application's userData directory:

```
%APPDATA%/[AppName]/
├── app-resolver-config.json       # Configuration
├── app-registry.json              # App Registry database
└── learning-data.json             # Learning System data
```

## API Reference

### AppResolver

```typescript
class AppResolver {
  constructor(
    config: AppResolverConfig,
    registry: AppRegistry,
    learning: LearningSystem,
    fuzzy: FuzzyMatcher,
    winRegistry: WindowsRegistrySearcher,
    cache: CacheManager
  );

  // Resolve application name to executable path
  async resolve(userInput: string): Promise<ResolutionResult>;

  // Report successful launch for learning
  async reportSuccess(userInput: string, executablePath: string): Promise<void>;

  // Report failed launch for learning
  async reportFailure(userInput: string, attemptedPath: string): Promise<void>;
}
```

### ResolutionResult

```typescript
interface ResolutionResult {
  success: boolean;                    // True if single match found
  executablePath?: string;             // Path to executable
  confidenceScore?: number;            // Confidence (0-1)
  strategy?: ResolutionStrategy;       // Strategy that found the match
  suggestions?: ResolutionSuggestion[]; // Multiple matches
  error?: string;                      // Error message
}
```

### ResolutionStrategy

```typescript
enum ResolutionStrategy {
  APP_REGISTRY = 'app_registry',
  LEARNING_SYSTEM = 'learning_system',
  FUZZY_MATCHER = 'fuzzy_matcher',
  WINDOWS_REGISTRY = 'windows_registry',
  FALLBACK = 'fallback'
}
```

## Testing

The system includes comprehensive test coverage:

- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test component interactions
- **Property-Based Tests**: Validate universal properties across random inputs

Run tests:
```bash
npm test app-resolver
```

## Contributing

When adding new predefined applications:

1. Add to `PREDEFINED_APPS` array in `predefinedApps.ts`
2. Include all common aliases
3. List all possible installation paths
4. Test on clean Windows installation

## License

Part of the main application - see root LICENSE file.
