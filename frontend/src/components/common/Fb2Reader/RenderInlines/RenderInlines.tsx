import { For, Match, Show, Switch } from 'solid-js';
import Button from '@/components/common/Button/Button';
import type { Fb2Inline } from '../fb2Types';
import { isExternalHref, normalizeInternalHref } from '../linkUtils';
import styles from './RenderInlines.module.scss';

function RenderInlines(props: {
  inlines: Fb2Inline[] | undefined;
  imageSrc: (id: string | undefined) => string | undefined;
  onInternalLink: (targetId: string) => void;
  onFootnoteLink: (targetId: string) => void;
  isFootnoteTarget: (targetId: string) => boolean;
}) {
  return (
    <For each={props.inlines ?? []}>
      {(inline) => (
        <Switch
          fallback={
            <RenderInlines
              inlines={inline.children}
              imageSrc={props.imageSrc}
              onInternalLink={props.onInternalLink}
              onFootnoteLink={props.onFootnoteLink}
              isFootnoteTarget={props.isFootnoteTarget}
            />
          }
        >
          <Match when={inline.kind === 'text'}>{inline.text}</Match>
          <Match when={inline.kind === 'strong'}>
            <strong>
              <RenderInlines
                inlines={inline.children}
                imageSrc={props.imageSrc}
                onInternalLink={props.onInternalLink}
                onFootnoteLink={props.onFootnoteLink}
                isFootnoteTarget={props.isFootnoteTarget}
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
                      if (inline.linkType === 'note' || props.isFootnoteTarget(targetId)) {
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
