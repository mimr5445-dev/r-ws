import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { AiStudioPanel } from './AiStudioPanel';

const noop = () => {};

test('AiStudioPanel يرسم لوحة الذكاء الاصطناعي المحلي دون أخطاء', () => {
  const html = renderToString(
    createElement(AiStudioPanel, {
      maps: {},
      actors: {},
      activeMapId: '',
      aiTopic: 'حصار بحري',
      onChangeAiTopic: noop,
      onApplyGeneratedYaml: noop,
      onCopyAiPrompt: noop,
      onCopyCatalog: noop,
      onOpenSpec: noop,
      setStatusNotice: noop
    })
  );
  assert.ok(html.includes('aiStudioPanel'));
  assert.ok(html.includes('ذكاء اصطناعي محلي'));
  assert.ok(html.includes('حصار بحري'));
  assert.ok(html.includes('http://127.0.0.1:11434/v1'));
  assert.ok(html.includes('aiGenerateBtn'));
});
