function unavailable() {
  return Response.json(
    { error: "NOT_FOUND" },
    { status: 404, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } },
  );
}

export {
  unavailable as GET,
  unavailable as POST,
  unavailable as PUT,
  unavailable as PATCH,
  unavailable as DELETE,
  unavailable as HEAD,
};
