/**
 * seed-csharp.js - Nạp kiến thức C# căn bản + nâng cao + OOP vào agent_qa_cache
 * 
 * Chạy: node seed-csharp.js
 */
const pool = require('../core/db');
const { embed } = require('../core/embed');

const QA_DATA = [

  // ======================== OOP CĂN BẢN ========================
  {
    q: "4 tính chất cơ bản của OOP (Hướng đối tượng) là gì?",
    a: "1) Encapsulation (Đóng gói): Gom data + methods vào class, giấu implementation qua access modifier (private/protected/public). 2) Inheritance (Kế thừa): Class con thừa hưởng properties/methods từ class cha, tái sử dụng code. 3) Polymorphism (Đa hình): Cùng method nhưng hành vi khác nhau tùy object (override, interface). 4) Abstraction (Trừu tượng): Chỉ expose cái cần thiết, giấu chi tiết phức tạp qua abstract class/interface.",
    cat: 'oop', tags: ['oop', 'encapsulation', 'inheritance', 'polymorphism', 'abstraction']
  },
  {
    q: "Encapsulation (Đóng gói) trong C# thực hiện như thế nào?",
    a: "Dùng access modifiers: private (chỉ trong class), protected (class + class con), internal (cùng assembly), public (mọi nơi). Property thay cho public field: private int _age; public int Age { get => _age; set { if (value >= 0) _age = value; } }. Lợi ích: kiểm soát validation, bảo vệ data integrity, thay đổi internal implementation mà không ảnh hưởng bên ngoài.",
    cat: 'oop', tags: ['encapsulation', 'access-modifier', 'property']
  },
  {
    q: "Inheritance (Kế thừa) trong C# hoạt động ra sao?",
    a: "Dùng dấu hai chấm: class Dog : Animal { }. C# chỉ single inheritance (1 class cha). Dùng base keyword gọi constructor cha: public Dog(string name) : base(name) { }. Override method: đánh dấu virtual ở cha, override ở con. sealed class ngăn kế thừa tiếp. Trong MDS: BaseForm → frmFeature, XtraUserControl → ucFeature. Tránh deep inheritance (>3 cấp).",
    cat: 'oop', tags: ['inheritance', 'virtual', 'override', 'sealed', 'base']
  },
  {
    q: "Polymorphism (Đa hình) trong C# có mấy loại?",
    a: "2 loại: 1) Compile-time (Method Overloading): cùng tên method, khác params. VD: Save(int id), Save(string name). 2) Runtime (Method Overriding): class con override method virtual của cha. VD: Animal.Speak() → Dog.Speak() return 'Woof'. Interface polymorphism: IService service = new TicketService(); service.Save() gọi đúng implementation. Đây là nền tảng của DI/IoC.",
    cat: 'oop', tags: ['polymorphism', 'overloading', 'overriding', 'interface']
  },
  {
    q: "Abstract class và Interface khác nhau thế nào?",
    a: "Abstract class: có thể có implementation, constructor, fields. Chỉ single inherit. Dùng khi có shared logic. VD: abstract class BaseService { protected void Log() { } abstract void Save(); }. Interface: chỉ có contract (C# 8+ cho default implementation). Multi-implement. Dùng khi cần contract thuần. VD: interface IService { Task SaveAsync(); }. Trong MDS: IFeatureService (interface) + FeatureService (class implement).",
    cat: 'oop', tags: ['abstract', 'interface', 'contract', 'design']
  },
  {
    q: "SOLID principles là gì?",
    a: "S - Single Responsibility: mỗi class chỉ 1 nhiệm vụ (Service xử lý logic, View xử lý UI). O - Open/Closed: mở rộng bằng kế thừa, không sửa code cũ. L - Liskov Substitution: class con thay thế được class cha. I - Interface Segregation: interface nhỏ gọn, không ép implement method không dùng. D - Dependency Inversion: depend vào abstraction (interface), không depend concrete class. Trong MDS: Autofac DI thực hiện nguyên tắc D.",
    cat: 'oop', tags: ['solid', 'design-principles', 'architecture']
  },

  // ======================== C# CĂN BẢN ========================
  {
    q: "Value types và Reference types trong C# khác gì nhau?",
    a: "Value types (struct, int, float, bool, enum, DateTime): lưu trực tiếp trên stack, copy giá trị khi gán. Reference types (class, string, array, object): lưu trên heap, biến chỉ chứa reference (con trỏ). Nullable value type: int? x = null;. Khi truyền vào method: value type copy, reference type truyền reference (sửa ảnh hưởng gốc). Boxing: int → object (tốn performance, tránh).",
    cat: 'csharp-basic', tags: ['value-type', 'reference-type', 'stack', 'heap']
  },
  {
    q: "String trong C# là immutable nghĩa là gì?",
    a: "Mỗi lần thay đổi string đều tạo object mới trên heap. s = s + 'abc' tạo string mới, string cũ chờ GC. Nối nhiều string → dùng StringBuilder: var sb = new StringBuilder(); sb.Append('a'); sb.Append('b'); string result = sb.ToString();. String interpolation: $\"Hello {name}\" (syntax sugar, compiler tối ưu). string.IsNullOrEmpty(s), string.IsNullOrWhiteSpace(s) để check null.",
    cat: 'csharp-basic', tags: ['string', 'immutable', 'stringbuilder']
  },
  {
    q: "Delegate, Event, Action, Func trong C# là gì?",
    a: "Delegate: kiểu dữ liệu chứa reference đến method. VD: delegate int MathOp(int a, int b);. Action: delegate trả void. Action<string> log = msg => Console.WriteLine(msg);. Func: delegate có return. Func<int,int,int> add = (a,b) => a+b;. Event: delegate đặc biệt, chỉ owner mới raise được. VD: public event EventHandler Click; Click?.Invoke(this, EventArgs.Empty);. Trong WinForms: btn.Click += handler; (subscribe event).",
    cat: 'csharp-basic', tags: ['delegate', 'event', 'action', 'func', 'lambda']
  },
  {
    q: "LINQ trong C# dùng để làm gì?",
    a: "LINQ (Language Integrated Query) cho phép query dữ liệu bằng syntax C#. 2 cú pháp: Query syntax: var result = from p in products where p.Price > 100 select p; Method syntax (phổ biến hơn): var result = products.Where(p => p.Price > 100).Select(p => p.Name).ToList(); Các method quan trọng: Where, Select, OrderBy, GroupBy, Join, First/FirstOrDefault, Any, Count, Sum, Distinct, Take, Skip. Áp dụng cho IEnumerable, List, DataTable, DB table.",
    cat: 'csharp-basic', tags: ['linq', 'query', 'where', 'select', 'lambda']
  },
  {
    q: "Generic trong C# là gì và dùng khi nào?",
    a: "Generic cho phép viết code type-safe mà không cần biết kiểu cụ thể. Class generic: class Repository<T> where T : class { public T GetById(int id) { } }. Method generic: T Parse<T>(string json). Constraints: where T : class (reference type), where T : struct (value type), where T : new() (có constructor), where T : IEntity (implement interface). Trong MDS: BaseService<T>, List<DTO>, IQueryQueue.Enqueue<T>(). Tránh boxing, tăng performance.",
    cat: 'csharp-basic', tags: ['generic', 'type-safe', 'constraint', 'reusable']
  },
  {
    q: "Nullable types và null handling trong C# modern?",
    a: "Nullable value type: int? x = null; x.HasValue, x.Value, x ?? 0 (null coalescing). Null conditional: obj?.Property?.Method(). Null coalescing assignment: x ??= defaultValue. Pattern matching: if (obj is string s) { use s }. Null forgiving: obj!.Method() (suppress warning). Trong MDS: clsSecurity.LoginUser?.id (tránh NullRef nếu chưa login). LUÔN check null trước khi dùng Value property.",
    cat: 'csharp-basic', tags: ['nullable', 'null', 'coalescing', 'conditional']
  },

  // ======================== C# NÂNG CAO ========================
  {
    q: "async/await trong C# hoạt động thế nào ở mức sâu?",
    a: "async method được compiler biến thành state machine (IAsyncStateMachine). await không block thread, nó 'đăng ký continuation' rồi release thread về pool. Khi task hoàn thành, continuation chạy trên SynchronizationContext (UI thread cho WinForms). ConfigureAwait(false) bỏ qua context, chạy trên bất kỳ thread nào. Task.Run() chạy code trên ThreadPool. ValueTask cho hot path (task hoàn thành ngay). Tránh async void trừ event handler.",
    cat: 'csharp-advanced', tags: ['async', 'await', 'state-machine', 'task', 'threading']
  },
  {
    q: "Garbage Collector (GC) trong .NET hoạt động ra sao?",
    a: "GC chia heap thành 3 generations: Gen0 (mới, GC thường xuyên), Gen1 (trung gian), Gen2 (lâu dài, GC hiếm). Objects sống sót qua mỗi GC được promote lên gen cao hơn. LOH (Large Object Heap) cho objects > 85KB. IDisposable + using block để giải phóng unmanaged resources (file, DB connection, GDI). Finalizer (~ClassName) chạy bởi GC thread, không đảm bảo timing. Best practice: implement Dispose pattern cho class có unmanaged resources.",
    cat: 'csharp-advanced', tags: ['gc', 'memory', 'dispose', 'generations', 'heap']
  },
  {
    q: "Reflection trong C# là gì và dùng khi nào?",
    a: "Reflection cho phép inspect và invoke types/methods/properties tại runtime. Type type = typeof(MyClass); var props = type.GetProperties(); var method = type.GetMethod('Save'); method.Invoke(instance, params);. Use cases: DI containers (Autofac dùng reflection resolve types), serialization, plugin systems, ORM mapping. Trong MDS: ShowUserControl dùng reflection gọi Initialize() và LoadData(). Nhược điểm: chậm hơn direct call 10-100x, mất compile-time safety.",
    cat: 'csharp-advanced', tags: ['reflection', 'runtime', 'invoke', 'metadata']
  },
  {
    q: "Extension methods trong C# tạo và dùng thế nào?",
    a: "Thêm method vào type có sẵn mà không sửa source. Syntax: static class StringExt { public static bool IsEmpty(this string s) => string.IsNullOrEmpty(s); }. Gọi: 'hello'.IsEmpty(). Phải ở static class, method static, param đầu có 'this'. Trong MDS: ex.ShowError(), msg.ShowQuestion(), gv.ExportToExcel(), gv.FocusRow() đều là extension methods trong Shared.UI.Extension và Shared.Common.Extension.",
    cat: 'csharp-advanced', tags: ['extension-method', 'static', 'helper']
  },
  {
    q: "IEnumerable vs IQueryable vs List khác nhau thế nào?",
    a: "IEnumerable<T>: Lazy evaluation, chạy trên memory (client-side). LINQ to Objects. Dùng cho collection đã load. IQueryable<T>: Lazy, chạy trên provider (server-side SQL). LINQ to SQL/EF dịch sang SQL query. Thêm Where() = thêm WHERE SQL. List<T>: Eager, đã materialized trong memory. .ToList() force evaluate. Quy tắc: filter sớm nhất có thể (IQueryable ở DB) trước khi ToList(). Tránh .ToList() trước .Where() → load toàn bộ bảng.",
    cat: 'csharp-advanced', tags: ['ienumerable', 'iqueryable', 'list', 'lazy', 'performance']
  },
  {
    q: "Record, Struct, Class trong C# khi nào dùng cái nào?",
    a: "Class: reference type, mutable, inheritance. Dùng cho entities, services, controllers. 95% cases. Struct: value type, nhẹ, copy-by-value. Dùng cho small data (Point, Color, DateTime). Tránh struct lớn (>16 bytes). Record (C# 9+): immutable reference type, value-based equality. record Person(string Name, int Age);. Dùng cho DTO, config, event data. Record struct: value type + record syntax. Trong MDS (.NET 4.6): chỉ có class và struct.",
    cat: 'csharp-advanced', tags: ['record', 'struct', 'class', 'value-type', 'immutable']
  },
  {
    q: "Pattern Matching trong C# là gì?",
    a: "Kiểm tra type và extract value trong 1 expression. Type pattern: if (obj is string s) { use s }. Switch expression: var msg = status switch { 'A' => 'Active', 'I' => 'Inactive', _ => 'Unknown' };. Property pattern: if (person is { Age: > 18, Name: not null }). Relational: case > 0 and < 100. Nested: if (order is { Customer: { VIP: true } }). Thay thế chuỗi if-else và type casting dài dòng. C# 7+ trở đi.",
    cat: 'csharp-advanced', tags: ['pattern-matching', 'switch', 'is', 'expression']
  },

  // ======================== DESIGN PATTERNS ========================
  {
    q: "Factory Pattern trong C# dùng thế nào?",
    a: "Tạo object mà không expose logic khởi tạo. Simple Factory: static class FormFactory { public static BaseForm Create(string type) { return type switch { 'order' => new frmOrder(), 'ticket' => new frmTicket(), _ => throw new ArgumentException() }; } }. Abstract Factory: interface tạo family of objects. Trong MDS: Autofac đóng vai trò factory cho tất cả Service/Controller/Form (resolve from container).",
    cat: 'design-pattern', tags: ['factory', 'creational', 'pattern']
  },
  {
    q: "Strategy Pattern là gì và khi nào dùng?",
    a: "Encapsulate family of algorithms, cho phép thay đổi algorithm tại runtime. VD: interface IExportStrategy { void Export(DataTable dt); } class ExcelExport : IExportStrategy { } class PdfExport : IExportStrategy { }. Client: _exporter.Export(data);. Dùng khi có nhiều cách xử lý cùng 1 việc (export Excel/PDF/CSV, validate theo rule khác nhau, calculate discount theo tier). Trong MDS: có thể áp dụng cho multi-format export.",
    cat: 'design-pattern', tags: ['strategy', 'behavioral', 'algorithm', 'pattern']
  },
  {
    q: "Dependency Injection (DI) là gì và tại sao quan trọng?",
    a: "DI là technique inject dependency từ bên ngoài thay vì tự tạo bên trong. Thay vì: class OrderService { private db = new DbContext(); } → dùng: class OrderService { public OrderService(IDbContext db) { _db = db; } }. Lợi ích: testable (mock IDbContext), loose coupling, dễ thay implementation. 3 loại: Constructor injection (phổ biến nhất), Property injection, Method injection. Container (Autofac/Unity) quản lý lifecycle (Singleton, Scoped, Transient).",
    cat: 'design-pattern', tags: ['di', 'dependency-injection', 'ioc', 'autofac', 'testing']
  },
  {
    q: "Decorator Pattern dùng để làm gì?",
    a: "Thêm chức năng cho object tại runtime mà không sửa class gốc. VD: interface ILogger { void Log(string msg); } class FileLogger : ILogger { } class TimestampDecorator : ILogger { private ILogger _inner; public void Log(string msg) => _inner.Log($\"[{DateTime.Now}] {msg}\"); }. Chain decorators: new TimestampDecorator(new FileLogger()). Trong thực tế: logging, caching, validation wrapping, retry logic.",
    cat: 'design-pattern', tags: ['decorator', 'structural', 'wrapper', 'pattern']
  },

  // ======================== COLLECTIONS & DATA STRUCTURES ========================
  {
    q: "Các collection phổ biến trong C# và khi nào dùng?",
    a: "List<T>: mảng động, truy cập index O(1), add O(1) amortized. Dùng nhiều nhất. Dictionary<K,V>: key-value, lookup O(1). Dùng cho mapping, cache. HashSet<T>: unique values, Contains O(1). Dùng cho check tồn tại. Queue<T>: FIFO. Stack<T>: LIFO. LinkedList<T>: insert/remove O(1), truy cập O(n). ConcurrentDictionary: thread-safe dictionary. ObservableCollection: notify UI khi thay đổi (WPF). Trong MDS: List cho grid data, Dictionary cho lookup cache.",
    cat: 'csharp-basic', tags: ['collection', 'list', 'dictionary', 'hashset', 'data-structure']
  },
  {
    q: "DataTable vs List<T> khi nào dùng cái nào?",
    a: "DataTable: dynamic schema, không biết kiểu compile-time. Dùng cho raw SQL query results, DevExpress grid binding, report data source. Truy cập: row['ColumnName']. List<T>: strongly-typed, IntelliSense, refactor-safe. Dùng cho business objects, DTO, LINQ operations. Trong MDS: Service trả DataTable cho grid display (FormQuery pattern), trả DTO/entity cho business logic. Trend: migrate dần sang List<T> khi có DTO.",
    cat: 'csharp-basic', tags: ['datatable', 'list', 'typed', 'grid', 'binding']
  },

  // ======================== ERROR HANDLING & DEBUGGING ========================
  {
    q: "Exception handling best practices trong C#?",
    a: "1) Catch specific exceptions trước generic: catch (SqlException) → catch (Exception). 2) KHÔNG catch exception rồi swallow (catch { }). 3) throw; (giữ stack trace) thay vì throw ex; (mất stack trace). 4) Custom exception: class BusinessException : Exception { }. 5) finally block cho cleanup. 6) using = try-finally cho IDisposable. 7) Global handler: AppDomain.UnhandledException, Application.ThreadException. 8) Log trước khi throw.",
    cat: 'csharp-advanced', tags: ['exception', 'try-catch', 'throw', 'best-practice']
  },
  {
    q: "Cách dùng using statement và IDisposable?",
    a: "using bọc IDisposable objects, tự gọi Dispose() khi ra khỏi scope (kể cả exception). using (var db = new DbContext()) { /* work */ } // Dispose() called. C# 8+: using var db = new DbContext(); // Dispose khi hết method. Implement IDisposable: class MyClass : IDisposable { public void Dispose() { _connection?.Close(); GC.SuppressFinalize(this); } }. Trong MDS: using cho dbMDSDataContext, SqlConnection, FileStream, Form (modal).",
    cat: 'csharp-basic', tags: ['using', 'idisposable', 'dispose', 'resource-management']
  },

  // ======================== THREADING & CONCURRENCY ========================
  {
    q: "Thread safety trong C# đạt được bằng cách nào?",
    a: "1) lock (syncObj) { /* critical section */ }: mutual exclusion. 2) ConcurrentDictionary, ConcurrentQueue: thread-safe collections. 3) Interlocked.Increment(ref counter): atomic operations. 4) SemaphoreSlim: limit concurrent access. 5) ReaderWriterLockSlim: multiple readers, single writer. 6) async/await tự nhiên thread-safe (không share state). Trong MDS: IQueryQueue serialize DB calls, lock cho shared resources, ConcurrentDictionary cho cache.",
    cat: 'csharp-advanced', tags: ['thread-safety', 'lock', 'concurrent', 'semaphore']
  },
  {
    q: "Task vs Thread trong C# khác nhau thế nào?",
    a: "Thread: OS-level, nặng (~1MB stack), manual lifecycle. Thread t = new Thread(DoWork); t.Start();. Task: abstraction trên ThreadPool, nhẹ, có return value, composable. Task.Run(() => DoWork()); await task;. Task<T> có return: var result = await Task.Run(() => Calculate());. Task ưu tiên hơn Thread trong 99% cases. Thread chỉ dùng khi cần control priority, apartment state (COM), hoặc long-running dedicated thread.",
    cat: 'csharp-advanced', tags: ['task', 'thread', 'threadpool', 'concurrency']
  },

  // ======================== .NET FRAMEWORK SPECIFICS ========================
  {
    q: "Sự khác nhau giữa .NET Framework, .NET Core, .NET 5+?",
    a: ".NET Framework (4.x): Windows-only, WinForms/WPF, System.Data.Linq. MDS đang dùng .NET 4.6.2. .NET Core (2.x/3.x): Cross-platform, performance cao, modern APIs. .NET 5/6/7/8: Unified platform, hợp nhất Framework + Core. Migration path: Framework → Core/5+ thay đổi csproj, NuGet, APIs tương thích phần lớn. LiteSql target .NET Standard 2.0 để chạy được cả 2.",
    cat: 'csharp-basic', tags: ['dotnet', 'framework', 'core', 'migration', 'standard']
  },
  {
    q: "Assembly, Namespace, Project trong .NET là gì?",
    a: "Assembly: file .dll hoặc .exe, đơn vị deploy. Chứa compiled code + metadata. Project: 1 project = 1 assembly. Solution: nhóm nhiều projects. Namespace: logical grouping, tránh name collision. using MDS.Application.Features.Sales;. Trong MDS: Solution = ERP, Projects = MDS.Application (features), MDSManagement (entry point), Shared.Common (utilities), Controllers (proxy + DI). Reference giữa projects = dependency.",
    cat: 'csharp-basic', tags: ['assembly', 'namespace', 'project', 'solution', 'dll']
  },

  // ======================== CODING BEST PRACTICES ========================
  {
    q: "Coding conventions và clean code trong C#?",
    a: "Naming: PascalCase cho public member/class/method, camelCase cho local/private, _prefix cho private field. Không dùng Hungarian notation (strName, intCount). Method < 30 dòng. Class < 300 dòng. Single return point khi có thể. Early return: if (input == null) return; thay vì nested if. Const cho magic numbers. Meaningful names: GetActiveOrders() thay vì GetData(). XML doc cho public APIs. Region chỉ dùng khi thật cần thiết.",
    cat: 'csharp-basic', tags: ['naming', 'clean-code', 'convention', 'readability']
  },
  {
    q: "DRY, KISS, YAGNI nghĩa là gì trong lập trình?",
    a: "DRY (Don't Repeat Yourself): Không duplicate code. Extract common logic vào method/class dùng chung. KISS (Keep It Simple, Stupid): Giải pháp đơn giản nhất mà hoạt động. Tránh over-engineering. YAGNI (You Aren't Gonna Need It): Không build feature chưa cần. Chỉ implement khi có requirement thực tế. Ví dụ: đừng tạo abstract factory phức tạp nếu chỉ có 1 implementation. Trong MDS: Service pattern đủ dùng, không cần Repository pattern thêm.",
    cat: 'oop', tags: ['dry', 'kiss', 'yagni', 'principles', 'clean-code']
  },
  {
    q: "Code smell phổ biến và cách fix?",
    a: "1) God Class (class quá lớn): tách partial class hoặc extract class. 2) Long Method (>30 dòng): extract method. 3) Feature Envy (method dùng nhiều data class khác): move method. 4) Magic Numbers: extract constant. 5) Deep Nesting (>3 cấp if): early return, strategy pattern. 6) Copy-Paste code: extract shared method. 7) Comments giải thích code xấu: refactor code cho readable. Trong MDS: dùng skill detect_large_methods để scan.",
    cat: 'oop', tags: ['code-smell', 'refactor', 'clean-code', 'anti-pattern']
  },
];

async function seedCSharp() {
  let inserted = 0, updated = 0;
  for (const item of QA_DATA) {
    const searchText = `${item.q} ${item.a}`.toLowerCase();
    const vec = await embed(searchText);
    const keywords = new Set();
    searchText.split(/[\s,.\-_()]+/).filter(w => w.length > 3).forEach(w => keywords.add(w));
    const cat = item.cat || 'general';
    const tags = item.tags || [];

    try {
      const result = await pool.query(`
        INSERT INTO agent_qa_cache (question, answer_context, search_text, keywords, embedding, confidence_score, source, category, tags)
        VALUES ($1, $2, $3, $4, $5, 1.0, 'seed', $6, $7)
        ON CONFLICT (question_hash) DO UPDATE SET
          answer_context = EXCLUDED.answer_context,
          search_text = EXCLUDED.search_text,
          keywords = EXCLUDED.keywords,
          embedding = EXCLUDED.embedding,
          source = 'seed',
          category = EXCLUDED.category,
          tags = EXCLUDED.tags,
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert
      `, [item.q, item.a, searchText, [...keywords], JSON.stringify(vec), cat, tags]);
      
      if (result.rows[0].is_insert) inserted++; else updated++;
      process.stdout.write(`\r[+] C# Knowledge: ${inserted + updated}/${QA_DATA.length} (new: ${inserted}, updated: ${updated})...`);
    } catch (err) {
      console.error(`\n[!] Failed: "${item.q.substring(0,50)}..." - ${err.message}`);
    }
  }

  console.log(`\n\n[DONE] C# & OOP Knowledge: Inserted ${inserted}, Updated ${updated}`);

  const stats = await pool.query(`
    SELECT category, COUNT(*) as cnt FROM agent_qa_cache GROUP BY category ORDER BY cnt DESC
  `);
  console.log('\n[FULL DB STATS]');
  stats.rows.forEach(r => console.log(`  ${r.category}: ${r.cnt}`));

  const total = await pool.query('SELECT COUNT(*) as total FROM agent_qa_cache');
  console.log(`  TOTAL: ${total.rows[0].total} entries`);

  await pool.end();
}

seedCSharp();
