import { For, Match, Show, Switch } from "solid-js";
import { Fb2Inline } from "../fb2Types";
import { isExternalHref, normalizeInternalHref } from "../linkUtils";
import styles from "./RenderInlines.module.scss";

type RenderInlinesProps = {
  inlines: Fb2Inline[] | undefined;
  imageSrc: (id: string | undefined) => string | undefined;
  onInternalLink: (targetId: string) => void;
};

function RenderInlines(props: RenderInlinesProps) {
  return (
    <For each={props.inlines ?? []}>
      {(inline) => (
        <Switch fallback={<RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />}>
          <Match when={inline.kind === "text"}>{inline.text}</Match>
          <Match when={inline.kind === "strong"}>
            <strong>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
            </strong>
          </Match>
          <Match when={inline.kind === "emphasis"}>
            <em>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
            </em>
          </Match>
          <Match when={inline.kind === "strikethrough"}>
            <s>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
            </s>
          </Match>
          <Match when={inline.kind === "sub"}>
            <sub>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
            </sub>
          </Match>
          <Match when={inline.kind === "sup"}>
            <sup>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
            </sup>
          </Match>
          <Match when={inline.kind === "code"}>
            <code>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
            </code>
          </Match>
          <Match when={inline.kind === "link"}>
            <Show
              when={isExternalHref(inline.href)}
              fallback={
                <button
                  class={styles.inlineLinkButton}
                  type="button"
                  onClick={() => {
                    const targetId = normalizeInternalHref(inline.href);

                    if (targetId) {
                      props.onInternalLink(targetId);
                    }
                  }}
                >
                  <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
                </button>
              }
            >
              <a href={inline.href} target="_blank" rel="noreferrer">
                <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
              </a>
            </Show>
          </Match>
          <Match when={inline.kind === "style"}>
            <span data-fb2-style={inline.styleName}>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
            </span>
          </Match>
          <Match when={inline.kind === "image"}>
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
