import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function UploadDialog({ open, onOpenChange }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [instruction, setInstruction] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const reset = () => {
    setFile(null);
    setInstruction('');
    setDragOver(false);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('select a file');
      const form = new FormData();
      form.append('file', file);
      if (instruction.trim()) form.append('userInstruction', instruction.trim());
      return api.createQuotation(form);
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['quotations'] });
      onOpenChange(false);
      reset();
      navigate({ to: '/quotations/$id', params: { id: data.quotationId } });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[18px] tracking-tight">
            New quotation
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Drop a supplier quotation file. Add a sourcing intent and we'll
            handle the negotiation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) setFile(dropped);
            }}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 px-6 py-7 text-center transition-colors',
              dragOver
                ? 'border-primary bg-accent/40'
                : 'border-border hover:border-foreground/30 hover:bg-muted/70',
            )}
          >
            {file ? (
              <>
                <FileSpreadsheet className="size-6 text-foreground" />
                <div className="font-mono text-[12px] text-foreground">
                  {file.name}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB · click to replace
                </div>
              </>
            ) : (
              <>
                <Upload className="size-5 text-muted-foreground" />
                <div className="text-[13px] font-medium text-foreground">
                  Drop an XLSX or click to browse
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Messy supplier quotations welcome — we'll parse it.
                </div>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </button>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground">
              Sourcing intent
              <span className="ml-1 text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={2}
              placeholder="Prioritize lead time and quality. Hard deadline 30 days."
              className="resize-none text-[13px]"
            />
          </div>

          {mutation.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {(mutation.error as Error).message ||
                'Upload failed — try again.'}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            disabled={!file || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Uploading…' : 'Start negotiation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
