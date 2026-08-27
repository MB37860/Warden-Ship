import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadImageBatch } from "../api/imageApi";

afterEach(() => {
  vi.restoreAllMocks();
});

function createImages(count) {
  return Array.from(
    { length: count },
    (_, index) =>
      new File([`pixel-${index}`], `image-${index}.jpg`, {
        type: "image/jpeg",
      }),
  );
}

function successfulUploadResponse(form) {
  const images = form.getAll("images").map((file) => ({
    id: file.name,
    file_id: file.name,
    filename: file.name,
    image_url: `/image/${file.name}`,
  }));

  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ images }),
  });
}

describe("uploadImageBatch", () => {
  it("uploads a large archive in bounded requests and reports stored progress", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, { body }) => successfulUploadResponse(body));
    const onProgress = vi.fn();

    const images = await uploadImageBatch(
      createImages(51),
      {},
      "large-archive",
      onProgress,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map(([, options]) =>
        options.body.getAll("images").length,
      ),
    ).toEqual([25, 25, 1]);
    expect(images).toHaveLength(51);
    expect(onProgress.mock.calls).toEqual([
      [25, 51],
      [50, 51],
      [51, 51],
    ]);
  });

  it("reports how many files were stored before a later batch fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce((_url, { body }) => successfulUploadResponse(body))
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "request too large" }),
      });

    await expect(uploadImageBatch(createImages(30), {}, "archive")).rejects.toThrow(
      "request too large after 25 of 30 images were stored",
    );
  });
});
