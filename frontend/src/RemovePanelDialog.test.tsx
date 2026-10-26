import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import RemovePanelDialog from "./RemovePanelDialog";
import type { Panel } from "./types";

vi.mock("./api", () => ({ api: vi.fn() }));
const mocked = vi.mocked(api);
const panel = {
  id: "test-panel",
  title: "Original uploaded panel",
  thumbnail_url: "/api/media/panels/test-thumb.jpg",
} as Panel;

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  mocked.mockReset();
});

test("cancel does not remove a panel and the confirmation explains retention", () => {
  const onClose = vi.fn();
  render(
    <RemovePanelDialog panel={panel} onClose={onClose} onRemoved={vi.fn()} />,
  );
  expect(screen.getByText(/Artwork stays in Studio storage/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(mocked).not.toHaveBeenCalled();
});

test("confirmation sends one request and cannot close while removal is saving", async () => {
  let finish!: (value: unknown) => void;
  mocked.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const onClose = vi.fn(),
    onRemoved = vi.fn();
  render(
    <RemovePanelDialog panel={panel} onClose={onClose} onRemoved={onRemoved} />,
  );
  const remove = screen.getByRole("button", { name: "Remove from library" });
  fireEvent.click(remove);
  fireEvent.click(remove);
  expect(mocked).toHaveBeenCalledExactlyOnceWith("/panels/test-panel", {
    method: "DELETE",
  });
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  const cancel = new Event("cancel", { cancelable: true });
  screen.getByRole("dialog").dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  expect(onRemoved).not.toHaveBeenCalled();
  finish({ id: panel.id, removed: true });
  await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
});

test("a failed removal stays open with a retryable error", async () => {
  mocked
    .mockRejectedValueOnce(new Error("Studio is offline"))
    .mockResolvedValue({});
  const onRemoved = vi.fn();
  render(
    <RemovePanelDialog panel={panel} onClose={vi.fn()} onRemoved={onRemoved} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove from library" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Studio is offline",
  );
  expect(onRemoved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove from library" }));
  await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
  expect(mocked).toHaveBeenCalledTimes(2);
});
