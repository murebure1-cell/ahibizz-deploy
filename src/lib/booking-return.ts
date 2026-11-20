export function bookingReturnPath(value: unknown): string {
  return typeof value === "string" &&
    /^(?:\/djelatnosti\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?:#business-(?:appointments|rentals|stays))?|\/ljudi\/[A-Za-z0-9_-]{1,128})$/i.test(
      value,
    )
    ? value
    : "/nalog";
}
