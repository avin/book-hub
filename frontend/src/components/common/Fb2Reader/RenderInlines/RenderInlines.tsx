import { For, Match, Show, Switch, type JSX } from 'solid-js';
import Button from '@/components/common/Button/Button';
import { inlineTextLength, type Fb2SearchRange } from '../fb2Search';
import type { Fb2Inline } from '../fb2Types';
import { isExternalHref, normalizeInternalHref } from '../linkUtils';
import { readerTextStyle } from '../readerTextStyle';
import styles from './RenderInlines.module.scss';

function RenderInlines(props: {
  inlines: Fb2Inline[] | undefined;
  imageSrc: (id: string | undefined) => string | undefined;
  onInternalLink: (targetId: string) => void;
  onFootnoteLink: (targetId: string) => void;
  isFootnoteTarget: (targetId: string) => boolean;
  searchRanges?: Fb2SearchRange[];
  textOffset?: number;
}) {
  const textOffset = () => props.textOffset ?? 0;
  const ranges = () => props.searchRanges ?? [];
  const offsetForIndex = (index: number) =>
    textOffset() +
    (props.inlines ?? [])
      .slice(0, index)
      .reduce((length, inline) => length + inlineTextLength(inline), 0);

  const renderText = (text: string, offset: number) => {
    if (!text || ranges().length === 0) {
      return text;
    }

    const parts: Array<string | JSX.Element> = [];
    let cursor = 0;

    for (const range of ranges()) {
      const start = Math.max(offset, range.start);
      const end = Math.min(offset + text.length, range.end);

      if (start >= end) {
        continue;
      }

      const localStart = start - offset;
      const localEnd = end - offset;

      if (localStart > cursor) {
        parts.push(text.slice(cursor, localStart));
      }

      parts.push(
        <mark
          data-search-match={range.key}
          data-search-active={range.active ? 'true' : 'false'}
          class={styles.searchMatch}
          classList={{ [styles.searchMatchActive]: Boolean(range.active) }}
        >
          {text.slice(localStart, localEnd)}
        </mark>,
      );
      cursor = localEnd;
    }

    if (cursor === 0) {
      return text;
    }

    if (cursor < text.length) {
      parts.push(text.slice(cursor));
    }

    return parts;
  };

  return (
    <For each={props.inlines ?? []}>
      {(inline, index) => (
        <Switch
          fallback={
            <RenderInlines
              inlines={inline.children}
              imageSrc={props.imageSrc}
              onInternalLink={props.onInternalLink}
              onFootnoteLink={props.onFootnoteLink}
              isFootnoteTarget={props.isFootnoteTarget}
              searchRanges={props.searchRanges}
              textOffset={offsetForIndex(index())}
            />
          }
        >
          <Match when={inline.kind === 'text'}>
            {renderText(inline.text ?? '', offsetForIndex(index()))}
          </Match>
          <Match when={inline.kind === 'lineBreak'}>
            <br />
          </Match>
          <Match when={inline.kind === 'strong'}>
            <strong>
              <RenderInlines
                inlines={inline.children}
                imageSrc={props.imageSrc}
                onInternalLink={props.onInternalLink}
                onFootnoteLink={props.onFootnoteLink}
                isFootnoteTarget={props.isFootnoteTarget}
                searchRanges={props.searchRanges}
                textOffset={offsetForIndex(index())}
              />
            </strong>
          </Match>
          <Match when={inline.kind === 'emphasis'}>
            <em>
              <RenderInlines
                inlines={inline.children}
                imageSrc={props.imageSrc}
                onInternalLink={props.onInternalLink}
                onFootnoteLink={props.onFootnoteLink}
                isFootnoteTarget={props.isFootnoteTarget}
                searchRanges={props.searchRanges}
                textOffset={offsetForIndex(index())}
              />
            </em>
          </Match>
          <Match when={inline.kind === 'strikethrough'}>
            <s>
              <RenderInlines
                inlines={inline.children}
                imageSrc={props.imageSrc}
                onInternalLink={props.onInternalLink}
                onFootnoteLink={props.onFootnoteLink}
                isFootnoteTarget={props.isFootnoteTarget}
                searchRanges={props.searchRanges}
                textOffset={offsetForIndex(index())}
              />
            </s>
          </Match>
          <Match when={inline.kind === 'sub'}>
            <sub>
              <RenderInlines
                inlines={inline.children}
                imageSrc={props.imageSrc}
                onInternalLink={props.onInternalLink}
                onFootnoteLink={props.onFootnoteLink}
                isFootnoteTarget={props.isFootnoteTarget}
                searchRanges={props.searchRanges}
                textOffset={offsetForIndex(index())}
              />
            </sub>
          </Match>
          <Match when={inline.kind === 'sup'}>
            <sup>
              <RenderInlines
                inlines={inline.children}
                imageSrc={props.imageSrc}
                onInternalLink={props.onInternalLink}
                onFootnoteLink={props.onFootnoteLink}
                isFootnoteTarget={props.isFootnoteTarget}
                searchRanges={props.searchRanges}
                textOffset={offsetForIndex(index())}
              />
            </sup>
          </Match>
          <Match when={inline.kind === 'code'}>
            <code>
              <RenderInlines
                inlines={inline.children}
                imageSrc={props.imageSrc}
                onInternalLink={props.onInternalLink}
                onFootnoteLink={props.onFootnoteLink}
                isFootnoteTarget={props.isFootnoteTarget}
                searchRanges={props.searchRanges}
                textOffset={offsetForIndex(index())}
              />
            </code>
          </Match>
          <Match when={inline.kind === 'link'}>
            <Show
              when={isExternalHref(inline.href)}
              fallback={
                <Button
                  variant="link"
                  type="button"
                  onClick={() => {
                    const targetId = normalizeInternalHref(inline.href);

                    if (targetId) {
                      if (inline.linkType === 'note') {
                        props.onFootnoteLink(targetId);
                        return;
                      }

                      props.onInternalLink(targetId);
                    }
                  }}
                  classList={{ [styles.footnoteLink]: inline.linkType === 'note' }}
                >
                  <RenderInlines
                    inlines={inline.children}
                    imageSrc={props.imageSrc}
                    onInternalLink={props.onInternalLink}
                    onFootnoteLink={props.onFootnoteLink}
                    isFootnoteTarget={props.isFootnoteTarget}
                    searchRanges={props.searchRanges}
                    textOffset={offsetForIndex(index())}
                  />
                </Button>
              }
            >
              <a href={inline.href} target="_blank" rel="noreferrer">
                <RenderInlines
                  inlines={inline.children}
                  imageSrc={props.imageSrc}
                  onInternalLink={props.onInternalLink}
                  onFootnoteLink={props.onFootnoteLink}
                  isFootnoteTarget={props.isFootnoteTarget}
                  searchRanges={props.searchRanges}
                  textOffset={offsetForIndex(index())}
                />
              </a>
            </Show>
          </Match>
          <Match when={inline.kind === 'style'}>
            <span data-fb2-style={inline.styleName}>
              <RenderInlines
                inlines={inline.children}
                imageSrc={props.imageSrc}
                onInternalLink={props.onInternalLink}
                onFootnoteLink={props.onFootnoteLink}
                isFootnoteTarget={props.isFootnoteTarget}
                searchRanges={props.searchRanges}
                textOffset={offsetForIndex(index())}
              />
            </span>
          </Match>
          <Match when={inline.kind === 'epubStyle'}>
            <span style={readerTextStyle(inline.textStyle)}>
              <RenderInlines
                inlines={inline.children}
                imageSrc={props.imageSrc}
                onInternalLink={props.onInternalLink}
                onFootnoteLink={props.onFootnoteLink}
                isFootnoteTarget={props.isFootnoteTarget}
                searchRanges={props.searchRanges}
                textOffset={offsetForIndex(index())}
              />
            </span>
          </Match>
          <Match when={inline.kind === 'image'}>
            <Show when={props.imageSrc(inline.imageId)}>
              {(src) => <img class={styles.inlineImage} src={src()} alt="" loading="lazy" />}
            </Show>
          </Match>
        </Switch>
      )}
    </For>
  );
}

export default RenderInlines;
