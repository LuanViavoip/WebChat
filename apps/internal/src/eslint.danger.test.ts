import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(import.meta.dirname, '..');
const probeFilePath = path.resolve(appRoot, 'src/App.tsx');

describe('regra ESLint contra dangerouslySetInnerHTML', () => {
  it('rejeita dangerouslySetInnerHTML em atributo JSX e em propriedade de objeto', async () => {
    const eslint = new ESLint({
      cwd: appRoot,
      overrideConfigFile: path.resolve(appRoot, 'eslint.config.js'),
    });

    const jsxResults = await eslint.lintText(
      "export function Danger(): unknown { return <div dangerouslySetInnerHTML={{ __html: 'x' }} />; }\n",
      { filePath: probeFilePath },
    );
    const jsxMessages = jsxResults[0]?.messages ?? [];
    expect(jsxMessages.some((m) => m.ruleId === 'no-restricted-syntax' && m.severity === 2)).toBe(true);

    const objResults = await eslint.lintText(
      "export const dangerProps = { dangerouslySetInnerHTML: { __html: 'x' } };\n",
      { filePath: probeFilePath },
    );
    const objMessages = objResults[0]?.messages ?? [];
    expect(objMessages.some((m) => m.ruleId === 'no-restricted-syntax' && m.severity === 2)).toBe(true);
  }, 15_000);
});
