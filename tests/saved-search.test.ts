import assert from "node:assert/strict";
import test from "node:test";
import { accountReturnPath } from "../src/lib/account-return";
import { canonicalSavedSearch } from "../src/lib/saved-search";

test("saved searches preserve canonical directory filters and a closed login return", () => {
  const filters = "?q=Prozori+i+vrata&mjesto=%C5%BDivinice&otvoreno=1";
  assert.equal(canonicalSavedSearch(filters), filters);
  assert.equal(accountReturnPath(`/pretraga${filters}`), `/pretraga${filters}`);
  assert.equal(accountReturnPath("/sacuvane-pretrage"), "/sacuvane-pretrage");
});
test("saved search destinations reject duplicates, pagination, fragments and external redirects", () => {
  for (const rejected of [
    "?q=a&q=b",
    "?page=10",
    "?q=a&page=2",
    "?q=%00",
    "?q=%FF",
    "?q=%20a",
    "?q=stolar&nastavi=https%3A%2F%2Fexample.invalid",
    "?q=a#b",
    "?nepoznato=1",
    "//example.invalid/?q=a",
    "?q=a&",
  ]) {
    assert.equal(canonicalSavedSearch(rejected), null);
    assert.equal(accountReturnPath(`/pretraga${rejected}`), "/nalog");
  }
});
