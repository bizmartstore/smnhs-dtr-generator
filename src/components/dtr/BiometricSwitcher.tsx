// Header-mounted biometric switcher + manage dialog.
import { useState } from "react";
import { Plus, Pencil, Trash2, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useDtrStore } from "@/lib/dtr-store";

export function BiometricSwitcher() {
  const store = useDtrStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Fingerprint className="h-4 w-4 text-muted-foreground shrink-0" />
      <Select
        value={store.state.currentBiometricId}
        onValueChange={(v) => void store.setCurrentBiometric(v)}
      >
        <SelectTrigger className="h-9 w-[180px] sm:w-[220px]">
          <SelectValue placeholder="Select biometric" />
        </SelectTrigger>
        <SelectContent>
          {store.state.biometrics.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-9">
            Manage
          </Button>
        </DialogTrigger>
        <ManageDialog onClose={() => setOpen(false)} />
      </Dialog>
    </div>
  );
}

function ManageDialog({ onClose }: { onClose: () => void }) {
  const store = useDtrStore();
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const create = async () => {
    try {
      const id = await store.createBiometric(newName);
      toast.success(`Created ${newName.trim() || "biometric"} (id ${id})`);
      setNewName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    }
  };
  const saveRename = async () => {
    if (!renaming) return;
    try {
      await store.renameBiometric(renaming.id, renaming.name);
      toast.success("Renamed");
      setRenaming(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename");
    }
  };
  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and ALL its data? This cannot be undone.`)) return;
    try {
      await store.deleteBiometric(id);
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Manage biometrics</DialogTitle>
        <DialogDescription>
          Each biometric has its own employees, raw logs, and overrides.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="border rounded-md divide-y">
          {store.state.biometrics.map((b) => (
            <div key={b.id} className="p-2 flex items-center gap-2">
              {renaming?.id === b.id ? (
                <>
                  <Input
                    value={renaming.name}
                    onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    className="h-8"
                  />
                  <Button size="sm" onClick={saveRename}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <div className="flex-1 text-sm">
                    <span className="text-muted-foreground">#{b.id}</span> — {b.name}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setRenaming({ id: b.id, name: b.name })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void remove(b.id, b.name)}
                    disabled={store.state.biometrics.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>

        <div>
          <Label>Add biometric</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Biometric 2 — Annex Bldg"
            />
            <Button onClick={create}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </DialogFooter>
    </DialogContent>
  );
}
