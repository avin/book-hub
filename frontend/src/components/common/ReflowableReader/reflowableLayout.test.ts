import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFb2 } from '../Fb2Reader/fb2Parser';
import { buildVirtualLayout, buildVirtualLayoutAsync } from './reflowableLayout';
import { defaultSettings } from './reflowableReaderSettings';
import type { ReflowableBlock } from './reflowableTypes';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('buildVirtualLayoutAsync', () => {
  it('сохраняет высоты и смещения синхронной раскладки для смешанного содержимого', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 8 }),
    } as unknown as CanvasRenderingContext2D);
    const blocks = parseFb2(`<FictionBook><body><section>
      <title><p>Глава с длинным названием</p></title>
      <p>Текст с <strong>выделением</strong>, <emphasis>курсивом</emphasis> и длинным абзацем для переноса строк.</p>
      <poem><stanza><v>Первая строка стихотворения</v><v>Вторая строка</v></stanza></poem>
      <empty-line/><image href="#image"/>
      <table><tr><th>Заголовок</th><td>Содержимое ячейки</td></tr></table>
    </section></body></FictionBook>`).blocks;
    blocks.push({
      id: 'code',
      kind: 'codeBlock',
      level: 0,
      role: 'body',
      inlines: [{ kind: 'text', text: 'line one\nline two' }],
    });

    for (const width of [320, 900]) {
      const expected = buildVirtualLayout(blocks, width, defaultSettings);
      expect(await buildVirtualLayoutAsync(blocks, width, defaultSettings)).toEqual(expected);
    }
  });

  it('не измеряет блоки отменённой загрузки', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();

    expect(
      await buildVirtualLayoutAsync([], 320, defaultSettings, controller.signal),
    ).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('отдаёт управление до измерений и прекращает работу при отмене между порциями', async () => {
    vi.useFakeTimers();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 20));
    let measuredBlocks = 0;
    const blocks: ReflowableBlock[] = Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      get kind() {
        measuredBlocks += 1;
        return 'emptyLine' as const;
      },
      level: 0,
      role: 'body',
    }));
    const controller = new AbortController();
    const result = buildVirtualLayoutAsync(blocks, 320, defaultSettings, controller.signal);
    expect(measuredBlocks).toBe(0);

    await vi.advanceTimersToNextTimerAsync();
    const blocksBeforeCancel = measuredBlocks;
    expect(blocksBeforeCancel).toBeGreaterThan(0);
    expect(blocksBeforeCancel).toBeLessThan(blocks.length);
    controller.abort();
    await vi.runAllTimersAsync();

    expect(await result).toBeUndefined();
    expect(measuredBlocks).toBe(blocksBeforeCancel);
    expect(vi.getTimerCount()).toBe(0);
  });
});
