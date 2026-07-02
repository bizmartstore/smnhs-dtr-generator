import { useDtrStore } from "@/lib/dtr-store";
import { TERM_KEYS, type TermKey } from "@/lib/dtr";
import { Button } from "@/components/ui/button";

/** Global 1/2/3-term switcher shown in the app header. */
export function TermSwitcher() {
  const store = useDtrStore();
  const active = store.state.activeTerm;
  return (
    <div className="inline-flex items-center gap-1 rounded-md border p-1 bg-background">
      <span className="text-[11px] sm:text-xs text-muted-foreground px-1">Term</span>
      {TERM_KEYS.map((t: TermKey) => (
        <Button
          key={t}
          type="button"
          size="sm"
          variant={active === t ? "default" : "ghost"}
          className="h-7 px-2 text-xs"
          onClick={() => store.setActiveTerm(t)}
          title={`Use Term ${t} official times`}
        >
          {t}
        </Button>
      ))}
    </div>
  );
}
