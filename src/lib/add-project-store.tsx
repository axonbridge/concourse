import { createContext, useCallback, useContext, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { api } from "~/lib/api";
import { useHotkey, isEditableTarget } from "~/lib/use-hotkey";
import {
  groupsQueryOptions,
  queryKeys,
  useGroups,
} from "~/queries";
import type { Group } from "~/db/schema";

type Ctx = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const AddProjectContext = createContext<Ctx | null>(null);

export function AddProjectProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialPath, setInitialPath] = useState("");
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: groups = [] } = useGroups();

  // Open the dialog directly (it has its own Browse button) so the user can
  // choose the source first: open a folder, or clone a repository.
  const open = useCallback(() => {
    setInitialPath("");
    void queryClient.ensureQueryData(groupsQueryOptions());
    setIsOpen(true);
  }, [queryClient]);
  const close = useCallback(() => {
    setIsOpen(false);
    setInitialPath("");
  }, []);
  const createGroupForSelection = useCallback(
    async (name: string) => {
      const { group } = await api.createGroup({ name });
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        current ? [...current, group] : [group],
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      return group;
    },
    [queryClient],
  );

  useHotkey(
    "project.add",
    (e) => {
      if (isEditableTarget(e.target)) return;
      open();
    },
    { preventDefault: true },
  );

  return (
    <AddProjectContext.Provider value={{ open, close, isOpen }}>
      {children}
      <ProjectDialog
        open={isOpen}
        project={null}
        initialPath={initialPath}
        groups={groups}
        onClose={close}
        onCreateGroup={createGroupForSelection}
        onSave={async (data) => {
          const { pendingImage, imagePath: _ignore, prepareWorkspace, ...createBody } = data;
          const { project: created } = await api.createProject(createBody);
          // Journey B: the project route consumes this flag on mount and opens
          // the "Prepare for Concourse" chat (each change approval-gated).
          if (prepareWorkspace) {
            sessionStorage.setItem(`mc.pendingPrepare.${created.id}`, "1");
          }
          if (pendingImage) {
            const electron = (await import("~/lib/electron")).getElectron();
            const result = await electron?.saveProjectImage({
              projectId: created.id,
              sourcePath: pendingImage.sourcePath,
              extension: pendingImage.extension,
            });
            if (result && "filename" in result) {
              await api.updateProject(created.id, { imagePath: result.filename });
            }
          }
          close();
          void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
          // Navigate into the new project when it needs follow-up (prepare chat)
          // or when the user is already inside a project view.
          if (prepareWorkspace || router.state.location.pathname.startsWith("/projects/")) {
            void router.navigate({ to: "/projects/$id", params: { id: created.id } });
          }
        }}
      />
    </AddProjectContext.Provider>
  );
}

export function useAddProject(): Ctx {
  const ctx = useContext(AddProjectContext);
  if (!ctx) throw new Error("useAddProject must be used within AddProjectProvider");
  return ctx;
}
