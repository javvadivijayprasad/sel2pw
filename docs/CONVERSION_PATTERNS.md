# sel2pw — Complete Conversion Pattern Reference

This is the canonical reference for **every Selenium Java / TestNG / BDD pattern that sel2pw understands** when converting to Playwright TypeScript. Each pattern is marked with one of:

- ✅ **Full** — auto-converted, no manual work needed
- ⚠️ **Partial** — converts in common cases, edge cases need review (flagged in `CONVERSION_REVIEW.md`)
- ❌ **Missing** — not yet rewritten, passes through as-is and likely needs manual fix
- 🔁 **Stub** — auto-stubbed; the helper class is replaced with a placeholder + migration recipe

Coverage at v0.10.7: **94 patterns mapped, 56 ✅ full, 18 ⚠️ partial, 14 ❌ missing, 6 🔁 stub.**

---

## 1. Imports

| Java (Selenium) | TypeScript (Playwright) | Coverage | Notes |
|---|---|---|---|
| `import org.openqa.selenium.*;` | `import { test, expect } from '@playwright/test';` | ✅ Full | Selenium imports stripped, Playwright imports emitted by emitters |
| `import org.openqa.selenium.WebElement;` | `import { Locator, Page } from '@playwright/test';` | ✅ Full | Auto-emitted in Page Object output |
| `import org.openqa.selenium.By;` | _(no equivalent — use `page.locator()`)_ | ✅ Full | Stripped from output |
| `import io.cucumber.java.en.*;` | `import { createBdd } from 'playwright-bdd';` | ✅ Full | `src/stretch/bdd.ts` |
| `import java.util.*;` | _(built-in JS/TS — stripped)_ | ✅ Full | Auto-stripped |
| `import org.testng.annotations.*;` | _(stripped — Playwright Test has no annotations)_ | ✅ Full | Auto-stripped |
| `import io.cucumber.java.en.{Given,When,Then};` | `const { Given, When, Then } = createBdd(test);` | ✅ Full | Emitted at top of step files |

---

## 2. Step Definitions (Cucumber BDD)

| Java | TypeScript | Coverage | Notes |
|---|---|---|---|
| `@Given("^User is on '(.*?)'$") public void userIsOn(String page) { ... }` | `Given("^User is on '(.*?)'$", async ({ page }, pageName: string) => { ... });` | ✅ Full | `bdd.ts` + javaExtractor classifies step files |
| `@When("...")` annotation | `When("...", async ({ page }, ...) => { ... })` | ✅ Full | Same |
| `@Then("...")` annotation | `Then("...", async ({ page }, ...) => { ... })` | ✅ Full | Same |
| `@And` / `@But` annotations | mapped to nearest preceding `Given/When/Then` | ✅ Full | Cucumber-standard behavior |
| Hooks (`@Before`, `@After` from cucumber) | `Before(async ({ page }) => { ... })` / `After(...)` | ✅ Full | Mapped via lifecycle |

---

## 3. Type Declarations

| Java | TypeScript | Coverage | Notes |
|---|---|---|---|
| `String name = "abc";` | `const name = "abc";` | ✅ Full | bodyTransformer `Type name = expr` rewrite |
| `String name;` | `let name: string;` | ⚠️ Partial | Bare declarations rewrite type but use `let`; user may want `const` |
| `int count = 0;` | `let count = 0;` | ✅ Full | |
| `boolean found = false;` | `let found = false;` | ✅ Full | |
| `String[] arr = new String[3];` | `const arr: string[] = [];` | ❌ **Missing** | Java arrays pass through as `String[]` literal |
| `int[] nums;` | `let nums: number[];` | ❌ **Missing** | Same |
| `List<String> list = new ArrayList<>();` | `const list: string[] = [];` | ✅ Full | `javaTypeToTs` |
| `Map<String, String> map = new HashMap<>();` | `const map: Record<string, string> = {};` | ✅ Full | `javaTypeToTs` |
| `Map<String, List<Foo>> nested;` | `const nested: Record<string, Foo[]> = {};` | ❌ **Missing** | Multi-param generics not yet recursive |
| `WebElement el;` | `let el: Locator;` | ⚠️ Partial | Page Object fields rewrite; method-local declarations don't always |
| `List<WebElement> elements;` | `let elements: Locator;` (single chained Locator) | ❌ **Missing** | Type position pass-through breaks output |
| `Promise<WebElement>` (return type) | `Locator` (sync — Playwright Locators are sync handles) | ❌ **Missing** | Method signature rewrites don't fire |
| `ResultSet rs;` | `// TODO: use pg client` | 🔁 Stub | DB code intentionally not auto-translated |
| `Object o;` | `let o: unknown;` | ✅ Full | `javaTypeToTs` |

---

## 4. Locators (`By` → `page.locator`)

| Java (Selenium) | TypeScript (Playwright) | Coverage |
|---|---|---|
| `driver.findElement(By.xpath("//div"))` | `page.locator("//div")` | ✅ Full |
| `driver.findElement(By.xpath("..."))` (alt: `xpath=` prefix) | `page.locator("xpath=...")` | ✅ Full |
| `driver.findElement(By.id("myId"))` | `page.locator("#myId")` | ✅ Full |
| `driver.findElement(By.cssSelector(".cls"))` | `page.locator(".cls")` | ✅ Full |
| `driver.findElement(By.name("q"))` | `page.locator('[name="q"]')` | ✅ Full |
| `driver.findElement(By.linkText("Sign out"))` | `page.getByRole('link', { name: 'Sign out' })` | ✅ Full |
| `driver.findElement(By.partialLinkText("Sign"))` | `page.getByRole('link', { name: 'Sign', exact: false })` | ✅ Full |
| `driver.findElement(By.tagName("button"))` | `page.locator('button')` | ✅ Full |
| `driver.findElement(By.className("btn"))` | `page.locator('.btn')` | ✅ Full |
| `driver.findElements(By.xpath("//div"))` | `page.locator("//div")` (Locator is already a list) | ✅ Full |
| `driver.findElements(...)` returning explicit `List<WebElement>` | `await page.locator(...).all()` | ⚠️ Partial | Emits `.all()` only when iterated; bare assignment loses it |
| `element.findElement(By.xpath(".//span"))` | `locator.locator(".//span")` | ✅ Full |
| `element.findElements(By.xpath(".//li"))` | `locator.locator(".//li")` | ✅ Full |
| `@FindBy(id="x") WebElement el` | `readonly el: Locator;` (initialised in ctor) | ✅ Full |
| `@FindBys` / `@FindAll` | first locator picked, others flagged for review | ⚠️ Partial |

---

## 5. Element Actions

| Java | TypeScript | Coverage |
|---|---|---|
| `element.click()` | `await locator.click()` | ✅ Full |
| `element.sendKeys("text")` | `await locator.fill('text')` | ✅ Full |
| `element.sendKeys(Keys.RETURN)` | `await locator.press('Enter')` | ✅ Full |
| `element.sendKeys(Keys.TAB)` | `await locator.press('Tab')` | ✅ Full |
| `element.sendKeys(Keys.ESCAPE)` | `await locator.press('Escape')` | ✅ Full |
| `element.clear()` | `await locator.clear()` | ✅ Full |
| `element.getText()` | `await locator.innerText()` | ✅ Full |
| `element.getAttribute("href")` | `await locator.getAttribute('href')` | ✅ Full |
| `element.isDisplayed()` | `await locator.isVisible()` | ✅ Full |
| `element.isEnabled()` | `await locator.isEnabled()` | ✅ Full |
| `element.isSelected()` | `await locator.isChecked()` | ✅ Full |
| `element.submit()` | `await locator.press('Enter')` | ✅ Full |
| `element.getCssValue("color")` | `await locator.evaluate(el => getComputedStyle(el).color)` | ⚠️ Partial |
| `element.getSize()` / `.getLocation()` | `await locator.boundingBox()` | ⚠️ Partial |
| `new Actions(driver).moveToElement(el).perform()` | `await locator.hover()` | ✅ Full |
| `new Actions(driver).doubleClick(el).perform()` | `await locator.dblclick()` | ✅ Full |
| `new Actions(driver).contextClick(el).perform()` | `await locator.click({ button: 'right' })` | ✅ Full |
| Compound `Actions` chains (drag-drop with intermediate steps) | flagged for manual port (recipes in CONVERSION_REVIEW.md) | ⚠️ Partial |

---

## 6. List / Collection Operations

| Java | TypeScript | Coverage |
|---|---|---|
| `elements.size()` (where elements is List<WebElement>) | `await locator.count()` | ❌ **Missing** |
| `elements.size()` (where elements is List<String>) | `elements.length` | ❌ **Missing** |
| `elements.get(i)` (List<WebElement>) | `locator.nth(i)` | ❌ **Missing** |
| `elements.get(i)` (List<String>) | `elements[i]` | ❌ **Missing** |
| `elements.isEmpty()` (List<WebElement>) | `(await locator.count()) === 0` | ❌ **Missing** |
| `elements.get(0).getText()` | `await locator.nth(0).innerText()` | ❌ **Missing** |
| `list.add(item)` | `list.push(item)` | ❌ **Missing** |
| `list.contains(item)` | `list.includes(item)` | ❌ **Missing** |
| `list.remove(i)` | `list.splice(i, 1)` | ❌ **Missing** |
| `list.indexOf(item)` | `list.indexOf(item)` (same) | ✅ Full (no rewrite needed) |
| `map.put("k", "v")` | `map["k"] = "v"` | ❌ **Missing** |
| `map.get("k")` | `map["k"]` | ❌ **Missing** |
| `map.containsKey("k")` | `"k" in map` | ❌ **Missing** |
| `map.keySet()` | `Object.keys(map)` | ❌ **Missing** |
| `map.values()` | `Object.values(map)` | ❌ **Missing** |

---

## 7. for-Loop Patterns

| Java | TypeScript | Coverage |
|---|---|---|
| `for (int i = 0; i < n; i++)` | `for (let i = 0; i < n; i++)` | ✅ Full (passes through) |
| `for (String s : list)` | `for (const s of list)` | ✅ Full |
| `for (WebElement el : elements)` | `for (let i = 0; i < await locator.count(); i++) { const el = locator.nth(i); }` | ❌ **Missing** |
| `list.forEach(item -> { ... })` | `list.forEach(item => { ... })` | ✅ Full (lambda → arrow) |
| `list.stream().map(x -> x.getText())` | `await Promise.all(list.map(x => x.innerText()))` | ❌ **Missing** |
| `list.stream().filter(x -> x.isDisplayed())` | `list.filter(async x => await x.isVisible())` | ❌ **Missing** |
| `list.stream().collect(Collectors.toList())` | _(redundant — drop)_ | ❌ **Missing** |
| `Arrays.asList(a, b, c)` | `[a, b, c]` | ❌ **Missing** |
| `Collections.sort(list)` | `list.sort()` | ❌ **Missing** |

---

## 8. if / Conditional Patterns

| Java | TypeScript | Coverage |
|---|---|---|
| `if (str.equals("val"))` | `if (str === 'val')` | ❌ **Missing** |
| `if (str.equalsIgnoreCase("val"))` | `if (str.toLowerCase() === 'val'.toLowerCase())` | ❌ **Missing** |
| `if (str.contains("sub"))` | `if (str.includes('sub'))` | ❌ **Missing** |
| `if (str.startsWith("x"))` | `if (str.startsWith('x'))` (same) | ✅ Full |
| `if (str.endsWith("x"))` | `if (str.endsWith('x'))` (same) | ✅ Full |
| `if (str.isEmpty())` | `if (str === '')` | ❌ **Missing** |
| `if (str != null)` | `if (str != null)` (same) | ✅ Full |
| `if (str == null)` | `if (str == null)` (same) | ✅ Full |
| `if (el.isDisplayed())` | `if (await el.isVisible())` | ✅ Full (apiMap) |
| `condition ? a : b` | `condition ? a : b` (same) | ✅ Full |
| `str instanceof String` | `typeof str === 'string'` | ❌ **Missing** |
| `obj instanceof MyClass` | `obj instanceof MyClass` (same) | ✅ Full |

---

## 9. String Operations

| Java | TypeScript | Coverage |
|---|---|---|
| `str.contains("x")` | `str.includes('x')` | ❌ **Missing** |
| `str.equals("x")` | `str === 'x'` | ❌ **Missing** |
| `str.equalsIgnoreCase("x")` | `str.toLowerCase() === 'x'.toLowerCase()` | ❌ **Missing** |
| `str.trim()` | `str.trim()` (same) | ✅ Full |
| `str.toLowerCase()` | `str.toLowerCase()` (same) | ✅ Full |
| `str.toUpperCase()` | `str.toUpperCase()` (same) | ✅ Full |
| `str.replace("a","b")` | `str.replace('a','b')` (same) | ✅ Full |
| `str.replaceAll("regex","b")` | `str.replace(/regex/g,'b')` | ❌ **Missing** |
| `str.split(",")` | `str.split(',')` (same) | ✅ Full |
| `str.substring(2)` | `str.substring(2)` (same) | ✅ Full |
| `str.substring(2,5)` | `str.substring(2,5)` (same) | ✅ Full |
| `str.indexOf("x")` | `str.indexOf('x')` (same) | ✅ Full |
| `str.length()` | `str.length` (no parens) | ❌ **Missing — silent break** |
| `str1 + str2` | `str1 + str2` | ✅ Full |
| `String.format("%d %s", n, s)` | `` `${n} ${s}` `` | ❌ **Missing** |
| `String.valueOf(num)` | `String(num)` | ❌ **Missing** |
| `Integer.parseInt(str)` | `parseInt(str, 10)` | ❌ **Missing** |
| `Double.parseDouble(str)` | `parseFloat(str)` | ❌ **Missing** |
| `Boolean.parseBoolean(str)` | `str.toLowerCase() === 'true'` | ❌ **Missing** |
| `str.matches("regex")` | `/regex/.test(str)` | ❌ **Missing** |

---

## 10. Assertions

| Java (TestNG / JUnit / Hamcrest) | TypeScript (Playwright Test) | Coverage |
|---|---|---|
| `Assert.assertEquals(expected, actual)` | `expect(actual).toBe(expected)` | ✅ Full |
| `Assert.assertEquals(expected, actual, msg)` | `expect(actual, msg).toBe(expected)` | ✅ Full |
| `Assert.assertTrue(condition)` | `expect(condition).toBe(true)` | ✅ Full |
| `Assert.assertFalse(condition)` | `expect(condition).toBe(false)` | ✅ Full |
| `Assert.assertNotNull(obj)` | `expect(obj).not.toBeNull()` | ✅ Full |
| `Assert.assertNull(obj)` | `expect(obj).toBeNull()` | ✅ Full |
| `Assert.assertTrue(list.size() > 0)` | `expect(await locator.count()).toBeGreaterThan(0)` | ⚠️ Partial (depends on §6 fix) |
| `verifyEquals(expected, actual, msg)` (soft) | `expect.soft(actual, msg).toBe(expected)` | ⚠️ Partial — currently maps to hard `expect` |
| `verifyEquals("text", el.getText(), ...)` | `await expect(locator).toHaveText("text")` | ⚠️ Partial — falls back to `expect(actual).toBe(expected)` |
| `assertThat(items, hasItem("x"))` (Hamcrest) | `expect(items).toContain("x")` | ✅ Full |
| `assertThat(items, hasSize(3))` | `expect(items).toHaveLength(3)` | ✅ Full |
| `assertThat(items, containsInAnyOrder(...))` | `expect(items).toEqual(expect.arrayContaining([...]))` | ✅ Full |
| `assertThat(value, greaterThan(5))` | `expect(value).toBeGreaterThan(5)` | ✅ Full |
| `assertThat(value, lessThanOrEqualTo(10))` | `expect(value).toBeLessThanOrEqual(10)` | ✅ Full |
| `assertThat(value, is(notNullValue()))` | `expect(value).not.toBeNull()` | ✅ Full |

---

## 11. Waits

| Java | TypeScript | Coverage |
|---|---|---|
| `Thread.sleep(5000)` | `await page.waitForTimeout(5000)` | ✅ Full |
| `new WebDriverWait(driver, 30).until(visibilityOf(el))` | `await locator.waitFor({ state: 'visible', timeout: 30000 })` | ✅ Full |
| `new WebDriverWait(driver, 30).until(invisibilityOf(el))` | `await locator.waitFor({ state: 'hidden', timeout: 30000 })` | ✅ Full |
| `ExpectedConditions.elementToBeClickable(el)` | `await locator.waitFor({ state: 'visible' })` (auto-waits) | ✅ Full |
| `ExpectedConditions.textToBePresentInElement(el, "x")` | `await expect(locator).toHaveText('x')` | ✅ Full |
| `ExpectedConditions.urlContains("x")` | `await page.waitForURL(/x/)` | ⚠️ Partial |
| `driver.manage().timeouts().implicitlyWait(10, SECONDS)` | _(removed — set in playwright.config.ts → use)_ | ✅ Full |
| `wait.until(driver -> someCondition())` (lambda predicate) | `await page.waitForFunction(() => ...)` | ⚠️ Partial |
| `FluentWait` / `Awaitility` | flagged for manual port | ⚠️ Partial |

---

## 12. Navigation

| Java | TypeScript | Coverage |
|---|---|---|
| `driver.navigate().to("url")` / `driver.get("url")` | `await page.goto('url')` | ✅ Full |
| `driver.navigate().back()` | `await page.goBack()` | ✅ Full |
| `driver.navigate().forward()` | `await page.goForward()` | ✅ Full |
| `driver.navigate().refresh()` | `await page.reload()` | ✅ Full |
| `driver.getCurrentUrl()` | `page.url()` | ✅ Full |
| `driver.getTitle()` | `await page.title()` | ✅ Full |
| `driver.getPageSource()` | `await page.content()` | ✅ Full |

---

## 13. Windows / Tabs

| Java | TypeScript | Coverage |
|---|---|---|
| `driver.getWindowHandles()` | `page.context().pages()` | ✅ Full |
| `driver.switchTo().window(handle)` | `const newPage = pages[1]` | ✅ Full |
| `element.click()` (opens new tab) | `const [newPage] = await Promise.all([page.context().waitForEvent('page'), locator.click()])` | ⚠️ Partial — emitted only when click decorated with new-tab annotation |
| `driver.close()` | `await page.close()` | ✅ Full |
| `driver.quit()` | _(removed — fixture handles teardown)_ | ✅ Full |

---

## 14. Alerts / Dialogs

| Java | TypeScript | Coverage |
|---|---|---|
| `driver.switchTo().alert().accept()` | `page.on('dialog', d => d.accept())` (preceded by trigger) | ✅ Full |
| `driver.switchTo().alert().dismiss()` | `page.on('dialog', d => d.dismiss())` | ✅ Full |
| `driver.switchTo().alert().getText()` | `dialog.message()` (inside handler) | ✅ Full |
| `driver.switchTo().alert().sendKeys("text")` | `page.on('dialog', d => d.accept('text'))` | ✅ Full |

---

## 15. iFrames

| Java | TypeScript | Coverage |
|---|---|---|
| `driver.switchTo().frame(0)` | `const frame = page.frameLocator('iframe').nth(0)` | ✅ Full |
| `driver.switchTo().frame("name")` | `const frame = page.frameLocator('[name="name"]')` | ✅ Full |
| `driver.switchTo().frame(el)` | `const frame = el.contentFrame()` | ⚠️ Partial |
| `driver.switchTo().defaultContent()` | _(automatic — frame locators are scoped)_ | ✅ Full |
| `driver.switchTo().parentFrame()` | _(automatic)_ | ✅ Full |

---

## 16. JavaScript Execution

| Java | TypeScript | Coverage |
|---|---|---|
| `((JavascriptExecutor)driver).executeScript("return document.title")` | `await page.evaluate(() => document.title)` | ✅ Full |
| `executeScript("arguments[0].click()", el)` | `await locator.evaluate(el => el.click())` | ✅ Full |
| `executeScript("arguments[0].scrollIntoView(true)", el)` | `await locator.scrollIntoViewIfNeeded()` | ✅ Full |
| `executeScript("window.scrollTo(0, document.body.scrollHeight)")` | `await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))` | ✅ Full |
| `executeAsyncScript(...)` | `await page.evaluate(async () => { ... })` | ⚠️ Partial — flagged for review |

---

## 17. Select Dropdowns

| Java | TypeScript | Coverage |
|---|---|---|
| `new Select(el).selectByVisibleText("opt")` | `await locator.selectOption({ label: 'opt' })` | ❌ **Missing** |
| `new Select(el).selectByValue("val")` | `await locator.selectOption({ value: 'val' })` | ❌ **Missing** |
| `new Select(el).selectByIndex(2)` | `await locator.selectOption({ index: 2 })` | ❌ **Missing** |
| `new Select(el).getFirstSelectedOption().getText()` | `await locator.inputValue()` | ❌ **Missing** |
| `new Select(el).getOptions()` | `await locator.locator('option').all()` | ❌ **Missing** |
| `new Select(el).deselectAll()` | `await locator.selectOption([])` | ❌ **Missing** |

---

## 18. Screenshots / File Upload

| Java | TypeScript | Coverage |
|---|---|---|
| `driver.getScreenshotAs(OutputType.FILE)` | `await page.screenshot({ path: 'shot.png' })` | ⚠️ Partial — recognized but path needs review |
| `el.getScreenshotAs(...)` | `await locator.screenshot({ path: 'shot.png' })` | ⚠️ Partial |
| `el.sendKeys("/path/to/file")` (file input) | `await locator.setInputFiles('/path/to/file')` | ✅ Full (advancedApiMap.ts:467) |

---

## 19. Database (PostgreSQL / ResultSet)

| Java | TypeScript | Coverage |
|---|---|---|
| `ResultSet rs = postgreconnect(sql)` | `// TODO: const res = await client.query(sql)` | 🔁 Stub |
| `rs.next()` | `res.rows.length > 0` | 🔁 Stub |
| `rs.getString("COL")` | `res.rows[0]['COL']` | 🔁 Stub |
| `rs.getInt("COL")` | `parseInt(res.rows[0]['COL'])` | 🔁 Stub |
| `Connection conn = DriverManager.getConnection(...)` | `// TODO: const client = new pg.Client(...)` | 🔁 Stub |

DB code is auto-stubbed by the customUtilDetector (classes named `*DbHelper`, `*DatabaseUtil`, etc.). The recipe in the stub file header points to the `pg` / `mysql2` / `mssql` npm package depending on which database the original code targets.

---

## 20. AWS / S3

| Java | TypeScript | Coverage |
|---|---|---|
| `s3Client.getObject(req, file)` | `// TODO: use @aws-sdk/client-s3 GetObjectCommand` | 🔁 Stub |
| `s3Client.deleteObject(req)` | `// TODO: use @aws-sdk/client-s3 DeleteObjectCommand` | 🔁 Stub |
| `s3Client.putObject(req)` | `// TODO: use @aws-sdk/client-s3 PutObjectCommand` | 🔁 Stub |

---

## 21. REST API Calls (Jersey / HttpClient / RestAssured)

| Java | TypeScript | Coverage |
|---|---|---|
| `Client client = Client.create()` | `// TODO: use axios or node-fetch` | 🔁 Stub |
| `WebResource r = client.resource(url)` | `const response = await fetch(url, ...)` | 🔁 Stub |
| `r.type("application/json").post(resp, body)` | `await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })` | 🔁 Stub |
| `clientResponse.getStatus()` | `response.status` | 🔁 Stub |
| `clientResponse.getEntity(String.class)` | `await response.text()` | 🔁 Stub |
| `new JSONObject(str)` | `JSON.parse(str)` | 🔁 Stub |
| `jsonObj.getString("key")` | `obj['key']` | 🔁 Stub |
| RestAssured `given().when().then()` chains | `// TODO: use APIRequestContext` | 🔁 Stub |

---

## 22. Exceptions / try-catch

| Java | TypeScript | Coverage |
|---|---|---|
| `try { ... } catch (Exception e) { ... }` | `try { ... } catch (e) { ... }` | ✅ Full |
| `catch (TimeoutException e)` | `catch (e) { /* check e instanceof Error */ }` | ⚠️ Partial — type narrowing not auto-rewritten |
| `e.getMessage()` | `(e as Error).message` | ❌ **Missing** |
| `e.getStackTrace()` | `(e as Error).stack` | ❌ **Missing** |
| `throw new RuntimeException(e)` | `throw e` | ⚠️ Partial — wrapper preserved, would emit invalid TS |
| `throws Exception` (method signature) | _(stripped — TS doesn't have checked exceptions)_ | ✅ Full |
| `finally { ... }` | `finally { ... }` (same) | ✅ Full |

---

## 23. Wait Constants (project-specific)

These are project-specific constants from your custom framework's BaseClass. sel2pw auto-stubs the BaseClass and emits these as TS constants in `tests/_legacy-stubs/base-class.ts`:

| Java constant | TypeScript equivalent |
|---|---|
| `VeryLongWait` | `const VeryLongWait = 30000;` |
| `LongWait` | `const LongWait = 20000;` |
| `MediumWait` | `const MediumWait = 10000;` |
| `ShorterWait` | `const ShorterWait = 5000;` |
| `ShortWait` | `const ShortWait = 3000;` |

Auto-stubbed via `customUtilDetector` because the BaseClass matches the `Constants$|Settings$|Config$` pattern. Coverage: 🔁 **Stub** — class auto-stubbed; users typically delete it and inline the values into `playwright.config.ts → use.actionTimeout` and individual test timeouts.

---

## 24. Step File Structure (Cucumber BDD)

| Java step file | TypeScript step file | Coverage |
|---|---|---|
| `package`, `import`, `class StepDefs { ... }` | `import { createBdd } from 'playwright-bdd';` + `const { Given, When, Then } = createBdd(test);` | ✅ Full |
| `@Given("...") public void method() { ... }` | `Given("...", async ({ page }, ...) => { ... });` | ✅ Full |
| Class-level setup fields (`WebDriver driver`, etc.) | _(removed — `page` injected via fixture)_ | ✅ Full |
| `@DataTableType` / `@ParameterType` Cucumber transformers | flagged for manual port | ⚠️ Partial |

Complete emitted output shape:

```typescript
import { createBdd } from 'playwright-bdd';
import { test, expect } from '@playwright/test';
import { Locator, Page } from '@playwright/test';

const { Given, When, Then } = createBdd(test);

Given("^User is on '(.*?)'$", async ({ page }, pageName: string) => {
  // implementation
});

When("^user does something$", async ({ page }) => {
  // implementation
});
```

---

## 25. Custom Helper Methods (project-specific patterns)

These are common conventions in TestNG-style Java frameworks. sel2pw stubs the helper class but doesn't yet rewrite call sites — that's a gap planned for 0.10.8.

| Java | TypeScript | Coverage | Plan |
|---|---|---|---|
| `elementExists(el)` returns `boolean` | `await el.isVisible()` | ❌ **Missing** | 0.10.8: detect helper class + rewrite call sites |
| `if (elementExists(el)) ...` | `if (await el.isVisible()) ...` | ❌ **Missing** | Same |
| `verifyEquals(true, elementExists(el), msg)` | `await expect(el).toBeVisible()` | ❌ **Missing** | Same |
| `verifyEquals(false, elementExists(el), msg)` | `await expect(el).not.toBeVisible()` | ❌ **Missing** | Same |
| `clickElement(el, ...)` (wrapper with retry) | `await el.click()` (Playwright auto-retries) | ❌ **Missing** | Same — drop the wrapper |
| `clickElement(el, "label", "page")` (named-arg variants) | `await el.click()` | ❌ **Missing** | Same |
| `verifyEquals("text", el.getText(), msg)` | `await expect(el).toHaveText("text")` | ⚠️ Partial | Currently maps to `expect(actual).toBe(expected)` |
| `verifyEquals(expected, list.size(), msg)` | `expect(await locator.count()).toBe(expected)` | ⚠️ Partial | Same |
| `safeClick(el)` / `clickWithRetry(el)` | `await el.click()` | ❌ **Missing** | Same family |
| `waitAndClick(el, ms)` | `await el.click({ timeout: ms })` | ❌ **Missing** | Same |
| `enterText(el, text)` | `await el.fill(text)` | ❌ **Missing** | Same |
| `getText(el)` (custom wrapper) | `await el.innerText()` | ❌ **Missing** | Same |

The detector classifies the containing class (`WebUI`, `WebActions`, `BrowserUtils`, `Helpers`, `BaseClass` are common names) as a stub. Without the call-site rewrite, every `clickElement(...)` becomes `await WebUI.notImplemented(...)` which compiles but throws at runtime.

---

## 26. WebDriver Lifecycle (already covered in §13 but explicit)

| Java | TypeScript | Coverage |
|---|---|---|
| `WebDriver driver = new ChromeDriver()` | _(removed — fixture provides `page`)_ | ✅ Full |
| `driver.manage().window().maximize()` | _(set in `playwright.config.ts → use.viewport`)_ | ✅ Full |
| `driver.manage().window().setSize(new Dimension(...))` | `await page.setViewportSize({ width, height })` | ⚠️ Partial |
| `driver.manage().deleteAllCookies()` | `await context.clearCookies()` | ✅ Full |
| `driver.manage().addCookie(new Cookie(...))` | `await context.addCookies([{ ... }])` | ✅ Full |

---

## 27. Page Object Model

| Java | TypeScript | Coverage |
|---|---|---|
| `public class LoginPage { @FindBy WebElement el; }` | `export class LoginPage { readonly el: Locator; constructor(public page: Page) { this.el = page.locator(...); } }` | ✅ Full |
| `extends BasePage` (POM superclass) | First level: emitted to `pages/base.page.ts`; nested levels flagged | ⚠️ Partial |
| `PageFactory.initElements(driver, this)` | _(removed — locators initialised in constructor)_ | ✅ Full |
| `@CacheLookup` | _(removed — no equivalent needed)_ | ✅ Full |

---

## 28. Test Lifecycle (TestNG / JUnit)

| Java | TypeScript | Coverage |
|---|---|---|
| `@Test` | `test('name', async ({ page }) => { ... })` | ✅ Full |
| `@BeforeMethod` / `@BeforeTest` | `test.beforeEach(async ({ page }) => { ... })` | ✅ Full |
| `@AfterMethod` / `@AfterTest` | `test.afterEach(...)` | ✅ Full |
| `@BeforeClass` / `@BeforeSuite` | `test.beforeAll(...)` | ✅ Full |
| `@AfterClass` / `@AfterSuite` | `test.afterAll(...)` | ✅ Full |
| `@DataProvider(name="x")` | typed `for` loop with `test()` inside | ✅ Full |
| `@Test(dataProvider="x")` on test method | `for (const row of x()) { test('...', async ...) }` | ⚠️ Partial — flagged for manual loop authoring |
| `@Test(groups={"smoke","regression"})` | mapped to `playwright.config.ts → projects` with `grep` tags | ✅ Full |
| `@Test(priority=1)` | _(stripped — Playwright doesn't have priority; tests run in file order)_ | ✅ Full |
| `@Test(enabled=false)` | `test.skip('name', ...)` | ✅ Full |
| `@Test(invocationCount=3)` | `for (let i = 0; i < 3; i++) { test('name #' + i, ...) }` | ⚠️ Partial |
| `@Test(timeOut=5000)` | `test('name', { timeout: 5000 }, async ...)` | ✅ Full |
| JUnit 4: `@Before` / `@After` | `test.beforeEach` / `test.afterEach` | ✅ Full |
| JUnit 5: `@BeforeEach` / `@AfterEach` / `@BeforeAll` / `@AfterAll` | same as TestNG mappings | ✅ Full |

---

## 29. Configuration Files

| Java config | TypeScript config | Coverage |
|---|---|---|
| `testng.xml` (suite definition) | `playwright.config.ts → projects` with `grep` tags | ✅ Full |
| `*.properties` (key/value config) | `.env.example` + typed `tests/config.ts` loader | ✅ Full |
| `pom.xml` (Maven dependencies) | `package.json` (manual transcription, Playwright + extras) | ⚠️ Partial — listed in MIGRATION_NOTES.md |
| `log4j.properties` | `pino` config or Playwright's built-in logger | ⚠️ Partial — flagged in review |

---

## 30. Listeners / Reporters

| Java | TypeScript | Coverage |
|---|---|---|
| `ITestListener` (TestNG) | flagged → use `playwright.config.ts → reporter` | 🔁 Stub |
| `IReporter` (TestNG) | flagged → built-in `html` / `list` / `json` reporters | 🔁 Stub |
| `IAnnotationTransformer` (TestNG) | flagged → no Playwright equivalent; rewrite as `test.use({...})` | 🔁 Stub |
| `IRetryAnalyzer` (TestNG) | mapped → `playwright.config.ts → retries: N` | 🔁 Stub |
| ExtentReports / Allure listeners | mapped → `allure-playwright` npm package | 🔁 Stub |

---

## Summary of gaps planned for 0.10.8

The "Missing" / "Partial" entries fall into four buckets, each becoming a focused patch in v0.10.8:

**A. Universal Java idioms** (sections 6, 7, 8, 9, 22)

`src/transformers/javaIdiomMap.ts` — regex rewrites for Java standard-library calls that have direct TS equivalents. About 40 patterns, all single-line replacements.

**B. Type-position rewrites** (section 3, 26)

Extend `javaTypeToTs` and the page-object/test emitter type-emission to cover `String[]` / `int[]`, multi-param generics, `WebElement` / `List<WebElement>` / `Promise<WebElement>` in method-local declarations and return types.

**C. Select-dropdown idiom** (section 17)

`new Select(el).selectByVisibleText("opt")` is so common it deserves its own dedicated transform. Six patterns total, all in `apiMap.ts`.

**D. Custom-helper call-site rewrites** (section 25)

Detect helper classes (`WebUI`, `WebActions`, `BrowserUtils`, `Helpers`, `BaseClass`) AND rewrite their call sites to inline Playwright primitives. The detector already stubs the class; this adds the call-site half.

**Estimated patch size for 0.10.8:** ~250 lines of new code, validated against selenium9-15 (no regressions) plus a fresh codebase that uses these idioms.

---

## Coverage scoreboard

| Category | Patterns | ✅ Full | ⚠️ Partial | ❌ Missing | 🔁 Stub |
|---|---:|---:|---:|---:|---:|
| Imports | 7 | 7 | 0 | 0 | 0 |
| Step definitions | 5 | 5 | 0 | 0 | 0 |
| Type declarations | 14 | 5 | 4 | 4 | 1 |
| Locators | 15 | 13 | 2 | 0 | 0 |
| Element actions | 18 | 14 | 4 | 0 | 0 |
| Collection ops | 15 | 1 | 0 | 14 | 0 |
| for-loop | 9 | 3 | 0 | 6 | 0 |
| if/conditional | 12 | 5 | 0 | 7 | 0 |
| String operations | 20 | 9 | 0 | 11 | 0 |
| Assertions | 15 | 11 | 4 | 0 | 0 |
| Waits | 9 | 6 | 3 | 0 | 0 |
| Navigation | 7 | 7 | 0 | 0 | 0 |
| Windows / tabs | 5 | 4 | 1 | 0 | 0 |
| Alerts / dialogs | 4 | 4 | 0 | 0 | 0 |
| iFrames | 5 | 4 | 1 | 0 | 0 |
| JS execution | 5 | 4 | 1 | 0 | 0 |
| Select dropdowns | 6 | 0 | 0 | 6 | 0 |
| Screenshots / files | 3 | 1 | 2 | 0 | 0 |
| Database | 5 | 0 | 0 | 0 | 5 |
| AWS / S3 | 3 | 0 | 0 | 0 | 3 |
| REST API | 8 | 0 | 0 | 0 | 8 |
| Exceptions | 7 | 4 | 1 | 2 | 0 |
| Wait constants | 5 | 0 | 0 | 0 | 5 |
| Step file structure | 4 | 3 | 1 | 0 | 0 |
| Custom helpers | 12 | 0 | 2 | 10 | 0 |
| WebDriver lifecycle | 5 | 4 | 1 | 0 | 0 |
| Page Object Model | 4 | 3 | 1 | 0 | 0 |
| Test lifecycle | 14 | 11 | 3 | 0 | 0 |
| Config files | 4 | 2 | 2 | 0 | 0 |
| Listeners / reporters | 5 | 0 | 0 | 0 | 5 |
| **Total** | **240** | **130** | **33** | **60** | **27** |

**At v0.10.7: 240 patterns mapped. 130 ✅ full coverage, 33 ⚠️ partial, 60 ❌ missing, 27 🔁 intentional-stub.**

**0.10.8 target: drop ❌ from 60 → ~10** (the genuinely-niche edges) by adding `javaIdiomMap.ts` + custom-helper rewriter + Select-dropdown transform + type-position rewrites.

After 0.10.8, expected coverage: **~190 ✅ full + 33 ⚠️ partial + 10 ❌ missing + 27 🔁 stub** out of 240 mapped patterns. That's a **79% full / 14% partial / 4% missing / 11% stub** split — credible 1.0.0 territory.
