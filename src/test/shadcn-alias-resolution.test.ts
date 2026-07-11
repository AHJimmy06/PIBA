import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type AliasMap = Record<string, string[]>;

function resolveAtAlias(alias: string, paths: AliasMap) {
  const mapping = paths['@/*']?.[0];
  if (!mapping || !alias.startsWith('@/')) return null;

  return path.resolve(process.cwd(), mapping.replace('*', alias.slice(2)));
}

describe('shadcn alias configuration', () => {
  const components = JSON.parse(fs.readFileSync('components.json', 'utf8')) as {
    aliases: Record<string, string>;
  };
  const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8')) as {
    compilerOptions: { paths: AliasMap };
  };

  it('resolves component and ui aliases to the presentation source directories', () => {
    expect(components.aliases.components).toBe('@/presentation/components');
    expect(components.aliases.ui).toBe('@/presentation/components/ui');
    expect(resolveAtAlias(components.aliases.components, tsconfig.compilerOptions.paths))
      .toBe(path.resolve(process.cwd(), 'src/presentation/components'));
    expect(resolveAtAlias(components.aliases.ui, tsconfig.compilerOptions.paths))
      .toBe(path.resolve(process.cwd(), 'src/presentation/components/ui'));
  });

  it('detects the obsolete components alias as an invalid install destination', () => {
    const obsoleteDestination = resolveAtAlias('@/components', tsconfig.compilerOptions.paths);

    expect(obsoleteDestination).toBe(path.resolve(process.cwd(), 'src/components'));
    expect(fs.existsSync(obsoleteDestination!)).toBe(false);
  });
});
