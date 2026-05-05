/**
 * seed-qa.js - Nạp bộ não Q&A mẫu vào agent_qa_cache
 * 
 * Chạy: node seed-qa.js
 * Chạy đè: node seed-qa.js --force (xoá hết QA cũ trước khi nạp)
 */
const pool = require('../core/db');
const { embed } = require('../core/embed');

const QA_DATA = [

  // ======================== KIẾN TRÚC UA (Universe Architecture) ========================
  {
    q: "Universe Architecture (UA) là gì và cấu trúc thư mục chuẩn ra sao?",
    a: "UA là kiến trúc chuẩn hóa cho tất cả feature trong hệ thống MDS WinForms. Mỗi feature nằm trong thư mục riêng theo pattern: Features/{Domain}/{Feature}/. Bên trong có 3 folder con: View/ (chứa form/UC), Controller/ (lớp proxy mỏng), Service/ (chứa toàn bộ business logic và data access). Nguyên tắc cốt lõi: View KHÔNG BAO GIỜ chứa SQL hay truy vấn DB trực tiếp.",
    cat: 'architecture', tags: ['ua', 'structure', 'folder']
  },
  {
    q: "Vai trò của View, Controller, Service trong kiến trúc UA là gì?",
    a: "View (frm*, uc*): Chỉ chứa UI logic, event handler, data binding, UI validation. KHÔNG chứa dbMDSDataContext hay TruyVanSQL. Controller: Là lớp proxy mỏng (thin pass-through) giữa View và Service. Inject dependency qua Autofac. Trả về bool/DTO để View tự quyết định hiển thị dialog. Service: Là 'fat logic hub', chứa toàn bộ business rule, data access bằng using (var db = dbMDSDataContext.New()). Mọi audit field (CreatedBy, ModifiedDate) xử lý ở Service, KHÔNG ở View.",
    cat: 'architecture', tags: ['ua', 'view', 'controller', 'service']
  },
  {
    q: "Nguyên tắc Thin View / Controller Delegation hoạt động thế nào?",
    a: "View chỉ xử lý giao diện, mọi thao tác DB đều delegate xuống Controller rồi xuống Service. Controller không chứa logic nặng, chỉ forward request. Ví dụ: khi user bấm Save, View gọi controller.Save(dto), Controller gọi service.Save(dto), Service thực hiện INSERT/UPDATE DB. Kết quả trả ngược lại dạng bool/ResultDTO. Dialog (ShowQuestion/ShowError) chỉ được gọi ở View, KHÔNG ở Service/Controller.",
    cat: 'architecture', tags: ['ua', 'delegation', 'thin-view']
  },

  // ======================== BASEFORM & LIFECYCLE ========================
  {
    q: "BaseForm và RunAfterShown pattern hoạt động như thế nào?",
    a: "BaseForm kế thừa từ MDS.Application.Shared.CustomControl. Form mới phải inherit BaseForm thay vì XtraForm. Override method RunAfterShown() để load dữ liệu sau khi UI đã hiển thị, tránh hiện tượng 'blank white screen'. Bắt buộc dùng cờ _isInitializing = true, set false sau khi load xong trong khối finally. Tất cả event handler phải check: if (_isInitializing) return; để tránh cascade event khi đang load.",
    cat: 'lifecycle', tags: ['baseform', 'runaftershown', 'initialization']
  },
  {
    q: "Tại sao phải xoá this.Load += trong Designer.cs khi dùng BaseForm?",
    a: "Khi migrate sang BaseForm, lifecycle được quản lý bởi RunAfterShown(). Nếu để lại dòng this.Load += new EventHandler(frmX_Load) trong Designer.cs, sẽ gây double-execution: cả Load event lẫn RunAfterShown đều chạy, dẫn đến lỗi duplicate data load, race condition, hoặc NullReferenceException. Cần xoá thủ công dòng này trong file .Designer.cs.",
    cat: 'lifecycle', tags: ['baseform', 'designer', 'migration']
  },
  {
    q: "Pattern PopulateControls và CollectData dùng để làm gì?",
    a: "Thay thế BindingSource dễ gãy. PopulateControls(): Map dữ liệu từ entity/DTO sang UI controls. Gọi khi load ban đầu và sau khi save thành công. CollectData(): Map ngược từ UI controls về entity. Thực hiện UI-level validation (empty check, range). Audit fields (CreatedBy, ModifiedDate) PHẢI xử lý ở Service layer, KHÔNG ở đây.",
    cat: 'lifecycle', tags: ['data-binding', 'populatecontrols', 'collectdata']
  },

  // ======================== DATA ACCESS & SQL ========================
  {
    q: "Cách truy vấn DB chuẩn trong Service layer là gì?",
    a: "Dùng using (var db = dbMDSDataContext.New()) cho LINQ to SQL hoặc LiteSql context. Với raw SQL queries, dùng DbHelper.Query() kèm SqlParameter để tránh SQL injection. KHÔNG BAO GIỜ dùng string interpolation hoặc string.Format cho SQL. Pattern: return _queue.Enqueue(() => DbHelper.Query('SELECT ... WHERE id = @id', new SqlParameter('@id', someId))).Result;"
  },
  {
    q: "DataAccessHelper.ExecuteQueryAsync là gì và dùng khi nào?",
    a: "DataAccessHelper.ExecuteQueryAsync(sql, params) là phương thức async chuẩn để chạy raw SQL query trả về DataTable. Dùng thay thế cho clsFunctions.TruyVanSQL (đã deprecated). Ưu điểm: thread-safe, async/await, dùng connection string chuẩn từ Config.ConnectionString. Dùng trong Service layer hoặc Controller proxy để load lookup data."
  },
  {
    q: "LiteSql ORM là gì và thay thế cái gì?",
    a: "LiteSql là thư viện thay thế LINQ to SQL (L2S) cho hệ sinh thái MDS/RAF/MLG2/MOP. Dựa trên Dapper, target .NET Standard 2.0. API tương thích: db.GetTable<T>(), db.SubmitChanges(), db.InsertOnSubmit(), db.DeleteOnSubmit(). Hỗ trợ async (SubmitChangesAsync, ExecuteQueryAsync), snapshot-based update tracking, Find/FindAsync, AsNoTracking. Tool LiteSql.CodeGen để migrate tự động từ .dbml."
  },
  {
    q: "Partial Service Class (FormQuery) pattern dùng khi nào?",
    a: "Khi Service file quá lớn (>500 dòng), tách lookup queries cho UI ra file riêng: FeatureService.FormQuery.cs (partial class). Method signature: public DataTable Get[Name]Data(...). Bắt buộc dùng parameterized SQL (SqlParameter). Ví dụ: PackingService.FormQuery.cs chứa 10+ lookup queries riêng biệt mà không làm phình file business logic chính."
  },

  // ======================== UI HELPERS & DEVEXPRESS ========================
  {
    q: "Cách thay thế clsFunctions.MSG_Error, MSG_Question, MSG_Information?",
    a: "Dùng extension methods từ Shared.UI thay vì clsFunctions: Error: ex.ShowError() hoặc msg.ShowError() thay cho clsFunctions.MSG_Error. Question: msg.ShowQuestion() trả về bool, thay cho clsFunctions.MSG_Question == DialogResult.Yes. Information: msg.ShowInfo() thay cho clsFunctions.MSG_Information. Cần using Shared.UI.Extension;"
  },
  {
    q: "Cách export GridView ra Excel chuẩn MDS?",
    a: "Dùng extension method gv.ExportToExcel() từ Shared.Common.Extension. KHÔNG dùng clsFunctions.XuatExcel (đã bị xoá hoàn toàn). Cần thêm using Shared.Common.Extension; Extension tự động format và đặt tên file chuẩn."
  },
  {
    q: "Cách setup GridLookUpEdit (gleXXX) properties data source?",
    a: "Dùng gleList.SetupUserList(users) hoặc gleID.Properties.DataSource = dataTable. Cũng dùng gleID.Properties.DisplayMember và gleID.Properties.ValueMember. Đảm bảo set DataSource TRƯỚC khi gán EditValue để tránh lỗi. Trong async RunAfterShown, load tất cả lookup trước rồi mới PopulateControls()."
  },
  {
    q: "Constants và magic strings xử lý thế nào trong MDS?",
    a: "KHÔNG dùng magic string hay hardcode color. Tạo class FeatureConstants trong folder của feature đó. Ví dụ: PackingConstants.ApprovedColor thay cho clsFunctions._color_Duyet. Đường dẫn file: dùng MDSEnvironments.RootFolderSave, MDSEnvironments.RootFolderTemp thay cho hardcode IP/path."
  },

  // ======================== DI & AUTOFAC ========================
  {
    q: "Autofac DI hoạt động thế nào trong MDS WinForms?",
    a: "Autofac được cấu hình trong Program.cs (ConfigureAutofac). Mọi Service, Controller, Form đều được đăng ký và resolve từ ILifetimeScope. Form constructor nhận Controller qua DI: public frmFeature(FeatureController controller). Modal form resolve bằng: using (var frm = _scope.Resolve<frmChangePassword>()) { frm.ShowDialog(); }. Child UserControl dùng ShowUserControl extension để tự resolve dependency."
  },
  {
    q: "IQueryQueue là gì và dùng thế nào?",
    a: "IQueryQueue là hàng đợi truy vấn thread-safe, đảm bảo các lệnh DB không chạy song song gây deadlock. Service sử dụng: _queue.Enqueue(() => DbHelper.Query(sql, params)).Result cho sync call, hoặc await _queue.Enqueue(() => ...) cho async. Inject qua constructor. Start/Stop quản lý ở frmMain lifecycle."
  },

  // ======================== NAMING CONVENTIONS ========================
  {
    q: "Quy tắc đặt tên biến, method, class trong MDS là gì?",
    a: "PascalCase cho method (LoadUserInfo thay vì load_thong_tin), property, class. camelCase cho local variable và private field (_isInitializing, _controller). Prefix: frm cho Form, uc cho UserControl, gle cho GridLookUpEdit, cb cho ComboBox, gv cho GridView, gc cho GridControl, btn/bt cho Button. Security objects: clsSecurity.LoginUser (PascalCase, không dùng loginUser)."
  },
  {
    q: "Naming convention cho file và folder feature?",
    a: "Folder structure: Features/{Domain}/{Feature}/View/frmXXX.cs, Features/{Domain}/{Feature}/Controller/XXXController.cs, Features/{Domain}/{Feature}/Service/XXXService.cs. Partial class cho form detail: frmXXX.Detail.cs, frmXXX.Post.cs. Service partial: XXXService.FormQuery.cs. Constants: XXXConstants.cs nằm trong folder feature."
  },

  // ======================== ASYNC & THREADING ========================
  {
    q: "Cách xử lý async trong WinForms event handler?",
    a: "Event handler có thể là async void (ngoại lệ chấp nhận được cho UI events). Pattern chuẩn: private async void btnSave_Click(object sender, EventArgs e) { try { var result = await _controller.SaveAsync(dto); if (result) msg.ShowInfo(); } catch (Exception ex) { ex.ShowError(); } }. RunAfterShown cũng dùng protected override async void RunAfterShown()."
  },
  {
    q: "Background loop trong frmMain chạy thế nào?",
    a: "Dùng async Task BackgroundLoopAsync(CancellationToken token) với vòng while (!token.IsCancellationRequested). Bên trong try-catch gọi CheckForUpdateAsync(), CheckDailyRestart(). Delay bằng await Task.Delay(TimeSpan.FromSeconds(15), token). CancellationTokenSource được dispose ở Form_Closing."
  },

  // ======================== DEBUGGING & COMMON ERRORS ========================
  {
    q: "Lỗi NullReferenceException trong EditValueChanged xảy ra khi nào?",
    a: "Thường xảy ra khi GridLookUpEdit hoặc ComboBox trigger event EditValueChanged trong quá trình load data (PopulateControls). Nguyên nhân: DataSource chưa được set hoặc giá trị EditValue chưa tồn tại trong DataSource. Fix: Luôn dùng cờ _isInitializing và check if (_isInitializing) return; ở đầu mỗi EditValueChanged handler."
  },
  {
    q: "Lỗi cross-thread operation trong WinForms xử lý thế nào?",
    a: "Xảy ra khi async callback cố gắng update UI từ background thread. Fix: Dùng Control.Invoke hoặc BeginInvoke: this.Invoke((Action)(() => { label.Text = result; })); Hoặc đảm bảo await được gọi trong UI context (SynchronizationContext tự quản lý nếu dùng async/await đúng cách trong event handler)."
  },
  {
    q: "Build bị lỗi CS1503 hoặc CS1061 sau refactor là do đâu?",
    a: "CS1503 (argument type mismatch): Thường do Service method signature thay đổi (sync->async) nhưng caller chưa cập nhật. CS1061 (does not contain a definition): Do method mới chưa được expose qua Controller proxy. Fix: Kiểm tra Controller có forward method tương ứng của Service chưa. Đảm bảo cùng signature (return type, params)."
  },

  // ======================== ACTION LOG & SECURITY ========================
  {
    q: "ActionLogHelper cấu hình và sử dụng như thế nào?",
    a: "Cấu hình trong Program.cs: ActionLogHelper.GetCurrentUserId = () => clsSecurity.LoginUser?.id; ActionLogHelper.GetConnectionString = () => Config.ConnectionString; ActionLogHelper.StoredProcedureName = 'sp_SYS_insert_Log'; Map param names (@idUser, @Action, @Details, @IP, @ComputerName, @Version). Sử dụng: ActionLogHelper.Log('Action Name', 'Detail'). Thay thế hoàn toàn clsFunctions.Logs."
  },
  {
    q: "Permission và phân quyền trong MDS hoạt động ra sao?",
    a: "Dùng clsSecurity.Permission_View() để check quyền xem module. IPermissionService inject vào Controller qua Autofac. ShowUserControl extension tự check permission trước khi hiển thị UC. Quyền được quản lý ở cấp module (view/edit/delete/approve). clsSecurity.LoginUser chứa thông tin user đang đăng nhập."
  },

  // ======================== GIT & DEPLOYMENT ========================
  {
    q: "Quy trình commit code trong dự án MDS?",
    a: "Commit message format: type(scope): description. Ví dụ: feat(Ticket): add warranty linking, refactor(StockIn): UA conformance, fix(Order): resolve null reference in detail grid. Commit sau mỗi task đã build và verify thành công. Không commit code chưa build được. Branch chính: Development."
  },
  {
    q: "Publish .NET application có mấy option?",
    a: "2 options bắt buộc hỗ trợ: Full (self-contained): --self-contained true -p:PublishSingleFile=true, copy và chạy không cần runtime. Lite (framework-dependent): --self-contained false -p:PublishSingleFile=true, nhẹ hơn nhưng yêu cầu .NET Runtime đã cài trên máy."
  },

  // ======================== DEVEXPRESS SPECIFIC ========================
  {
    q: "Cách bind dữ liệu cho GridControl/GridView trong MDS?",
    a: "Set gc.DataSource = dataTable hoặc gc.DataSource = List<DTO>. GridView (gv) tự động tạo columns từ DataSource. Để custom columns: dùng designer hoặc code gv.Columns['FieldName'].Caption = 'Tiêu đề'. Focus row: gv.FocusRow() extension thay cho clsFunctions.FocusRow(). Lấy giá trị row hiện tại: gv.GetFocusedRowCellValue('FieldName')."
  },
  {
    q: "DevExpress XtraReport tạo và bind như thế nào?",
    a: "Tạo class kế thừa XtraReport. Bind data qua DataSource property. Master-Detail: dùng DetailReportBand với DataMember. Parameter: dùng report.Parameters. Preview: reportPrintTool.ShowPreview(). Có skill devexpress_report trong hệ thống để hỗ trợ tạo report Master-Detail tự động."
  },

  // ======================== SEMANTIC SYSTEM KNOWLEDGE ========================
  {
    q: "Hệ thống Semantic Router của Agent hoạt động thế nào?",
    a: "Agent hoạt động theo luồng Zero-Knowledge: 1) find-recipe.js tìm Execution Plan cache trong agent_recipes. Nếu HIT thì follow steps. 2) Nếu MISS, find-skill.js tìm skill/workflow phù hợp bằng vector similarity. 3) Execute task. 4) save-recipe.js lưu execution plan mới. 5) mark-recipe.js đánh dấu success/fail. Embedding model: paraphrase-multilingual-MiniLM-L12-v2 (384 dim, hỗ trợ tiếng Việt)."
  },
  {
    q: "Bảng agent_qa_cache dùng để làm gì và khác gì agent_recipes?",
    a: "agent_recipes: Lưu Execution Plan (JSON steps hành động), dùng cho TASK commands (refactor, create, audit). agent_qa_cache: Lưu câu hỏi-đáp lý thuyết (Knowledge Base), dùng cho KNOWLEDGE questions (giải thích quy trình, kiến trúc). Tách biệt để tránh nhiễu: không nhồi text dài vào JSON steps. find-qa.js với threshold 0.6, auto-qa.js tự gọi Gemini/Opus khi MISS."
  },

  // ======================== MODULE-SPECIFIC KNOWLEDGE ========================
  {
    q: "Module Inventory (Kho) trong MDS có những sub-feature nào?",
    a: "Inventory chia thành: Product (Catalog, StockIn, StockOut, InspectionRequest, LotTracking), Material (Catalog, StockIn, StockOut, MaterialRequest). Mỗi sub-feature follow UA structure. StockIn/StockOut liên kết chặt với Production (lệnh sản xuất) và Sales (đơn hàng). LotTracking theo dõi vòng đời lot từ sản xuất đến xuất kho."
  },
  {
    q: "Module TSS (Technical Support) gồm những phần nào?",
    a: "TSS có 3 feature chính: Ticket (quản lý yêu cầu hỗ trợ kỹ thuật, liên kết Warranty/CaseSuggest/NewFeature), Warranty (bảo hành sản phẩm, WarrantyRepair), và Article (tài liệu kỹ thuật). Ticket đã được refactor theo UA, dùng async DataAccessHelper, BaseForm pattern. Warranty đang trong quá trình chuẩn hóa."
  },
  {
    q: "Module Production (Sản xuất) có cấu trúc ra sao?",
    a: "Production gồm: Assembly (AssemblyCatalog - danh mục lắp ráp), ProductionSchedule (kế hoạch sản xuất), QualityControl (kiểm tra chất lượng). AssemblyCatalog hiển thị trạng thái Board/Shell Info dựa trên MaterialRequest status: 'Đủ' nếu đã xuất kho, 'Chưa đủ' nếu chưa, rỗng nếu chưa tạo yêu cầu vật tư."
  },
  {
    q: "Module Sales (Bán hàng) bao gồm những gì?",
    a: "Sales có: Order (quản lý đơn hàng), Packing (đóng gói - gold standard refactoring), Invoice (hóa đơn). Packing module là case study chuẩn cho UA migration: đã hoàn thành BaseForm, RunAfterShown, Partial Service FormQuery, parameterized SQL, 5 sub-forms. Luồng: Ticket -> Approval -> Journal."
  },

  // ======================== ENVIRONMENT & TOOLS ========================
  {
    q: "MDSEnvironments cung cấp những gì?",
    a: "MDSEnvironments chứa các đường dẫn chuẩn của hệ thống: RootFolderSave (thư mục lưu file đính kèm), RootFolderTemp (thư mục tạm). Dùng thay cho hardcode IP hoặc magic string path. Import: using MDS.Application.Shared;"
  },
  {
    q: "ShowUserControl extension hoạt động ra sao?",
    a: "Extension method trên PanelControl: panel.ShowUserControl(key, typeof(ucFeature), navBar, _scope). Tự động resolve UserControl từ Autofac ILifetimeScope. Cache instance nếu keepInMemory=true. Gọi Initialize(openFrom) và LoadData() qua reflection. Check permission tự động. Nằm trong Controllers.Extension namespace."
  },

  // ======================== FILE ATTACHMENT ========================
  {
    q: "Component FileAttachmentEdit tích hợp vào form như thế nào?",
    a: "Dùng workflow /use-sys-attachment. FileAttachmentEdit là component dùng chung kết hợp DB để đính kèm file. Gắn vào form bằng cách add control, set properties (TableName, RecordId), bind sự kiện Load/Save. File được lưu trên server theo đường dẫn MDSEnvironments.RootFolderSave. Metadata lưu trong bảng hệ thống sys_Attachment.",
    cat: 'integration', tags: ['attachment', 'file', 'component']
  },

  // ======================== C# PATTERNS & BEST PRACTICES ========================
  {
    q: "Cách tạo Service mới cho một feature trong MDS?",
    a: "Tạo file FeatureService.cs trong folder Service/ của feature. Kế thừa interface IFeatureService. Inject IQueryQueue qua constructor. Dùng using (var db = dbMDSDataContext.New()) cho data access. Đăng ký trong Autofac module: builder.RegisterType<FeatureService>().As<IFeatureService>().InstancePerLifetimeScope(). Có skill create_service hỗ trợ tạo tự động.",
    cat: 'architecture', tags: ['service', 'create', 'autofac', 'di']
  },
  {
    q: "Cách tạo Controller mới cho một feature?",
    a: "Tạo file FeatureController.cs trong folder Controller/. Inject IFeatureService, IPermissionService, IUserService qua constructor. Controller chỉ là thin proxy: mỗi method gọi thẳng xuống service tương ứng. KHÔNG chứa business logic. Đăng ký trong Autofac. Có skill create_controller hỗ trợ.",
    cat: 'architecture', tags: ['controller', 'create', 'proxy']
  },
  {
    q: "Cách xử lý transaction trong Service layer?",
    a: "Dùng DataContext transaction: using (var db = dbMDSDataContext.New()) { db.Connection.Open(); using (var tx = db.Connection.BeginTransaction()) { db.Transaction = tx; try { /* operations */ db.SubmitChanges(); tx.Commit(); } catch { tx.Rollback(); throw; } } }. KHÔNG BAO GIỜ dùng transaction ở View/Controller.",
    cat: 'data-access', tags: ['transaction', 'service', 'database']
  },
  {
    q: "SQL Injection là gì và cách phòng tránh trong MDS?",
    a: "SQL Injection xảy ra khi ghép chuỗi user input vào SQL query. Phòng tránh: LUÔN dùng SqlParameter. Sai: $\"SELECT * WHERE name = '{input}'\". Đúng: DbHelper.Query(\"SELECT * WHERE name = @name\", new SqlParameter(\"@name\", input)). Quy tắc cứng: mọi query có input từ user phải parameterized. Đây là lỗ hổng bảo mật nghiêm trọng nhất.",
    cat: 'security', tags: ['sql-injection', 'parameterized', 'security']
  },
  {
    q: "Cách handle exception đúng chuẩn trong MDS WinForms?",
    a: "View layer: try-catch bọc event handler, catch gọi ex.ShowError(). Service layer: throw exception để View bắt, KHÔNG swallow exception. Controller: forward exception, không catch. Pattern: private async void btn_Click(object s, EventArgs e) { try { await _controller.DoWork(); } catch (Exception ex) { ex.ShowError(); } }. Global handler: Application.ThreadException trong Program.cs.",
    cat: 'debugging', tags: ['exception', 'error-handling', 'try-catch']
  },
  {
    q: "Cách dùng DTO (Data Transfer Object) trong MDS?",
    a: "DTO nằm trong folder DTOs/ của feature, hoặc feature-local. Dùng để truyền dữ liệu giữa Service-Controller-View thay vì truyền entity DB trực tiếp. Có skill extract_dto để tự động trích xuất DTO từ parameter list hoặc DataTable. DTO giúp decouple View khỏi DB schema, dễ test, dễ maintain.",
    cat: 'architecture', tags: ['dto', 'pattern', 'decouple']
  },
  {
    q: "Cách sử dụng IEventBus để đồng bộ cross-module?",
    a: "IEventBus cho phép module giao tiếp without direct reference. Publish: _eventBus.Publish(new OrderCreatedEvent { OrderId = id }). Subscribe: _eventBus.Subscribe<OrderCreatedEvent>(e => RefreshGrid()). Dùng khi cần thông báo giữa các form/module khác nhau (ví dụ: tạo đơn hàng xong thì refresh grid kho). Thread-safe, weak reference để tránh memory leak.",
    cat: 'architecture', tags: ['eventbus', 'cross-module', 'messaging', 'decouple']
  },

  // ======================== DEVEXPRESS NÂNG CAO ========================
  {
    q: "Cách custom format cell trong GridView DevExpress?",
    a: "Dùng event CustomColumnDisplayText hoặc RowCellStyle. Format số: gv.Columns['Amount'].DisplayFormat.FormatString = '#,##0'. Đổi màu theo điều kiện: gv.RowCellStyle += (s,e) => { if (e.Column.FieldName == 'Status' && e.CellValue.ToString() == 'Approved') e.Appearance.BackColor = Color.LightGreen; };. Format date: FormatString = 'dd/MM/yyyy'.",
    cat: 'devexpress', tags: ['gridview', 'format', 'display', 'color']
  },
  {
    q: "Cách tạo master-detail trong GridControl DevExpress?",
    a: "Dùng GridLevelNode: GridView detailView = new GridView(gc); gc.LevelTree.Nodes.Add('DetailRelation', detailView); Bind DataSource bằng DataSet với DataRelation giữa master table và detail table. Hoặc handle MasterRowExpanded event để lazy-load detail data. Trong report: dùng DetailReportBand + DataMember.",
    cat: 'devexpress', tags: ['master-detail', 'gridcontrol', 'relation']
  },
  {
    q: "Cách tạo và dùng RepositoryItemLookUpEdit trong grid?",
    a: "Tạo: var riLookup = new RepositoryItemLookUpEdit(); riLookup.DataSource = dtLookup; riLookup.DisplayMember = 'Name'; riLookup.ValueMember = 'Id'; riLookup.Columns.Add(new LookUpColumnInfo('Name', 'Tên')); Gán vào column: gv.Columns['CategoryId'].ColumnEdit = riLookup; Dùng khi cần dropdown lookup ngay trong cell grid.",
    cat: 'devexpress', tags: ['lookup', 'grid', 'repository-item', 'dropdown']
  },
  {
    q: "Cách handle SplashScreen và WaitForm trong DevExpress?",
    a: "SplashScreen khi khởi động app: SplashScreenManager.ShowForm(typeof(SplashScreen1)). WaitForm cho thao tác lâu: SplashScreenManager.ShowWaitForm(); try { await LongOperation(); } finally { SplashScreenManager.CloseWaitForm(); }. Đảm bảo luôn Close trong finally để tránh treo khi exception.",
    cat: 'devexpress', tags: ['splash', 'waitform', 'loading', 'ux']
  },
  {
    q: "Cách validate dữ liệu input trên DevExpress form?",
    a: "Dùng ValidationRules trên DXValidationProvider: dxValidation.SetValidationRule(txtName, new ConditionValidationRule { ConditionOperator = ConditionOperator.IsNotBlank, ErrorText = 'Bắt buộc' }); Hoặc manual validate trong CollectData(): if (string.IsNullOrEmpty(txtName.Text)) { 'Tên không được trống'.ShowError(); return false; }. Luôn validate ở View trước khi gửi xuống Controller.",
    cat: 'devexpress', tags: ['validation', 'input', 'form', 'dxvalidation']
  },

  // ======================== REFACTORING & MIGRATION ========================
  {
    q: "Quy trình refactor feature cũ sang UA conformance?",
    a: "1) Audit: chạy skill audit_code_quality hoặc workflow /audit-ua. 2) Tạo folder Service/ và Controller/ nếu chưa có. 3) Trích xuất SQL/DB access từ View sang Service (dùng skill extract_business_logic). 4) Tạo Controller proxy. 5) Đổi View inherit BaseForm, implement RunAfterShown. 6) Xoá this.Load trong Designer.cs. 7) Build verify. 8) Commit. Có workflow /ua-refactor tự động hóa.",
    cat: 'refactoring', tags: ['ua', 'refactor', 'migration', 'workflow']
  },
  {
    q: "Cách migrate từ clsFunctions sang helper hiện đại?",
    a: "Mapping: clsFunctions.TruyVanSQL → DataAccessHelper.ExecuteQueryAsync. clsFunctions.MSG_Error → msg.ShowError(). clsFunctions.MSG_Question → msg.ShowQuestion(). clsFunctions.XuatExcel → gv.ExportToExcel(). clsFunctions.Logs → ActionLogHelper.Log(). clsFunctions._color_Duyet → FeatureConstants.ApprovedColor. clsFunctions.addComboBox → cbUnit.SetupComboBox(dt, 'FieldName').",
    cat: 'refactoring', tags: ['migration', 'clsfunctions', 'legacy', 'helper']
  },
  {
    q: "Cách trích xuất business logic từ View sang Service?",
    a: "Dùng skill extract_business_logic. Quy trình: 1) Tìm tất cả đoạn code có dbMDSDataContext, TruyVanSQL, SelectData trong View. 2) Tạo method tương ứng trong Service (cùng signature). 3) Di chuyển logic vào Service method. 4) View gọi qua Controller proxy. 5) Đảm bảo UI dialog (ShowQuestion/ShowError) vẫn ở View. Pattern: if (condition) { logic } → Service trả bool, View check bool rồi show dialog.",
    cat: 'refactoring', tags: ['extract', 'business-logic', 'service', 'migration']
  },
  {
    q: "Khi nào cần tách partial class cho Service?",
    a: "Khi Service file > 500 dòng hoặc có > 5 lookup queries cho UI. Tách thành: FeatureService.cs (business logic chính: Save, Delete, Approve), FeatureService.FormQuery.cs (các method Get*Data trả DataTable cho UI). Cả 2 file dùng cùng partial class. Import: using MDS.Application.Features.{Domain}.{Feature}.Service;",
    cat: 'architecture', tags: ['partial-class', 'service', 'formquery', 'organization']
  },

  // ======================== DATABASE & QUERY PATTERNS ========================
  {
    q: "Cách viết stored procedure call từ Service?",
    a: "Dùng DbHelper.Execute hoặc DataAccessHelper với SqlParameter. Pattern: var result = DbHelper.Execute('sp_Feature_Save', new SqlParameter('@Id', id), new SqlParameter('@Name', name), new SqlParameter('@ModifiedBy', userId)); Hoặc async: await DataAccessHelper.ExecuteNonQueryAsync('sp_Feature_Delete @Id', new SqlParameter('@Id', id));",
    cat: 'data-access', tags: ['stored-procedure', 'execute', 'sqlparameter']
  },
  {
    q: "Cách phân trang (paging) dữ liệu lớn trong grid?",
    a: "Server-side paging: SELECT * FROM (SELECT ROW_NUMBER() OVER(ORDER BY Id) AS RowNum, * FROM Table) AS T WHERE RowNum BETWEEN @start AND @end. Hoặc OFFSET-FETCH: SELECT * FROM Table ORDER BY Id OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY. Truyền pageIndex và pageSize từ View xuống Service. Grid chỉ bind trang hiện tại.",
    cat: 'data-access', tags: ['paging', 'performance', 'query', 'large-data']
  },
  {
    q: "DbHelper và DataAccessHelper khác nhau thế nào?",
    a: "DbHelper: Synchronous, dùng IQueryQueue để thread-safe. Pattern: _queue.Enqueue(() => DbHelper.Query(sql, params)).Result. DataAccessHelper: Asynchronous native (ExecuteQueryAsync, ExecuteNonQueryAsync). Không cần IQueryQueue. Ưu tiên dùng DataAccessHelper cho code mới. DbHelper cho code legacy đang migrate dần.",
    cat: 'data-access', tags: ['dbhelper', 'dataaccesshelper', 'async', 'sync']
  },

  // ======================== BUSINESS MODULES CHI TIẾT ========================
  {
    q: "Quy trình xuất kho (StockOut) trong MDS?",
    a: "Luồng: 1) Tạo phiếu xuất kho từ Production Order hoặc Sales Order. 2) Chọn sản phẩm từ tồn kho (StockIn records). 3) Validate số lượng tồn >= số lượng xuất. 4) Ghi nhận xuất kho, trừ tồn. 5) In phiếu xuất. Liên kết: StockOut → links to ProductionSchedule hoặc SalesOrder. Trạng thái: Draft → Approved → Completed.",
    cat: 'module', tags: ['stockout', 'inventory', 'production', 'workflow']
  },
  {
    q: "Quy trình nhập kho (StockIn) trong MDS?",
    a: "Luồng: 1) Tạo phiếu nhập từ PurchaseOrder, Production output, hoặc Return. 2) Nhập thông tin Lot/Serial, số lượng, vị trí kho. 3) Kiểm tra QC nếu cần (link InspectionRequest). 4) Approve phiếu nhập. 5) Cập nhật tồn kho. Barcode: Tự sinh theo format MLG2 + YYMM + sequence. Trạng thái: Draft → Inspecting → Approved.",
    cat: 'module', tags: ['stockin', 'inventory', 'lot', 'barcode']
  },
  {
    q: "Barcode generation logic trong MDS hoạt động ra sao?",
    a: "Format barcode: Prefix (MLG2) + YYMM + Sequence (3-4 số). Ví dụ: MLG22603001. Logic: EquipmentInService.GetBarcodeOrder() lấy max sequence hiện tại từ DB, substring đúng vị trí prefix+date, increment +1. Lưu ý: index substring phải chính xác theo độ dài prefix, sai index sẽ generate sai sequence (bug đã gặp và fix).",
    cat: 'module', tags: ['barcode', 'sequence', 'generation', 'equipment']
  },
  {
    q: "QC Inspection Request trong MDS chạy thế nào?",
    a: "Luồng: 1) Tạo InspectionRequest khi StockIn cần kiểm tra chất lượng. 2) QC team nhận request, tiến hành kiểm tra. 3) Cập nhật kết quả (Pass/Fail/Partial). 4) Nếu Pass: approve StockIn. 5) Nếu Fail: reject hoặc return. Liên kết: InspectionRequest → StockIn → Product. UpdateInspectionResultDTO dùng để update kết quả.",
    cat: 'module', tags: ['qc', 'inspection', 'stockin', 'quality']
  },
  {
    q: "MaterialRequest (Yêu cầu vật tư) chạy thế nào?",
    a: "Luồng: 1) Production tạo MaterialRequest dựa trên BOM (Bill of Materials). 2) Kho kiểm tra tồn. 3) Nếu đủ: xuất kho theo request. 4) Nếu thiếu: báo mua thêm. Trạng thái hiển thị trên AssemblyCatalog: 'Đủ' (đã xuất kho), 'Chưa đủ' (chưa xuất), rỗng (chưa tạo request). Liên kết: MaterialRequest → ProductionSchedule → Assembly.",
    cat: 'module', tags: ['material', 'request', 'production', 'bom']
  },
  {
    q: "Ticket lifecycle trong module TSS?",
    a: "Luồng: 1) Tạo ticket (loại: Warranty, CaseSuggest, NewFeature). 2) Assign cho technician. 3) Technician xử lý, update progress. 4) Link sang Warranty repair nếu cần. 5) Close ticket khi xong. Fields quan trọng: TicketType, Priority, AssignedTo, Status, LinkedWarrantyId. View: frmTicket (BaseForm), frmTicket.Detail.cs, frmTicket.Post.cs (partial classes).",
    cat: 'module', tags: ['ticket', 'tss', 'warranty', 'lifecycle']
  },
  {
    q: "HandOver (Bàn giao) module xử lý gì?",
    a: "Quản lý việc bàn giao sản phẩm từ sản xuất sang QA sang bán hàng. Luồng: Production → QA check → HandOver record → Sales/Shipping. Form: frmSX_QA_BanGiao. Đã refactor theo UA: Service layer xử lý transaction, View dùng BaseForm, async operations. Legacy: có manual transaction logic đã migrate sang Service.",
    cat: 'module', tags: ['handover', 'production', 'qa', 'sales']
  },

  // ======================== PERFORMANCE & OPTIMIZATION ========================
  {
    q: "Cách tối ưu performance cho grid load dữ liệu lớn?",
    a: "1) Server-side paging (OFFSET/FETCH). 2) GridView.OptionsBehavior.Editable = false nếu read-only. 3) gv.BeginUpdate()/EndUpdate() bọc data binding. 4) Chỉ SELECT cột cần thiết, tránh SELECT *. 5) Index DB cho cột filter/sort. 6) Lazy load detail data (MasterRowExpanded). 7) Dùng ServerMode nếu > 100K rows. 8) Tránh RowCellStyle với logic nặng.",
    cat: 'performance', tags: ['grid', 'optimization', 'paging', 'devexpress']
  },
  {
    q: "Cách tránh memory leak trong WinForms?",
    a: "1) Dispose form/control khi đóng: using (var frm = ...) hoặc override Dispose. 2) Unsubscribe event khi form close: obj.Event -= Handler. 3) IEventBus dùng WeakReference. 4) Timer.Stop() trong Form_Closing. 5) Hủy CancellationTokenSource. 6) Tránh static reference đến form instance. 7) GridControl: đặt DataSource = null trước khi dispose.",
    cat: 'performance', tags: ['memory-leak', 'dispose', 'winforms', 'cleanup']
  },
  {
    q: "Connection pooling trong MDS hoạt động thế nào?",
    a: "ADO.NET tự quản lý connection pool. Config trong connection string: Max Pool Size=100; Min Pool Size=5; Connection Timeout=30. dbMDSDataContext.New() lấy connection từ pool, Dispose() trả lại pool (không đóng thật). LUÔN dùng using block để đảm bảo connection được return pool. Nếu quên Dispose: pool cạn → timeout exception.",
    cat: 'performance', tags: ['connection', 'pool', 'database', 'adonet']
  },

  // ======================== TESTING & DEBUGGING NÂNG CAO ========================
  {
    q: "Cách debug async code trong WinForms?",
    a: "1) Đặt breakpoint trong async method. 2) Debug > Windows > Tasks để xem pending tasks. 3) Kiểm tra SynchronizationContext: await phải return về UI thread. 4) Dùng ConfigureAwait(false) trong Service (không cần UI context). 5) Lỗi hay gặp: deadlock kếu gọi .Result trên async method từ UI thread → dùng await thay .Result ở View.",
    cat: 'debugging', tags: ['async', 'debug', 'deadlock', 'breakpoint']
  },
  {
    q: "Lỗi deadlock do .Result gọi async từ UI thread?",
    a: "Nguyên nhân: UI thread block chờ .Result, nhưng async method cần return về UI thread (SynchronizationContext) → deadlock vĩnh viễn. Fix: 1) Dùng await thay .Result ở View layer. 2) Dùng ConfigureAwait(false) trong Service/Helper. 3) IQueryQueue xử lý bằng background thread riêng nên an toàn khi gọi .Result từ Service. KHÔNG gọi .Result trong event handler.",
    cat: 'debugging', tags: ['deadlock', 'async', 'result', 'ui-thread']
  },
  {
    q: "Cách kiểm tra code có tuân thủ UA không?",
    a: "Chạy workflow /audit-ua hoặc skill audit_code_quality. Kiểm tra: 1) View có chứa dbMDSDataContext/TruyVanSQL không? → Fail. 2) Form inherit BaseForm chưa? 3) Có RunAfterShown + _isInitializing? 4) Controller có thin không? 5) clsFunctions đã thay hết chưa? 6) SQL có parameterized? Dùng skill parallel_module_audit cho batch check nhiều module.",
    cat: 'refactoring', tags: ['audit', 'ua', 'compliance', 'check']
  },

  // ======================== CONFIG & ENVIRONMENT ========================
  {
    q: "Config.ConnectionString lấy từ đâu và cấu hình ra sao?",
    a: "Lưu trong app.config hoặc App.Settings. Đọc qua Config.ConnectionString (static property). Format: Server=IP;Database=DBName;User Id=user;Password=pass;. Các môi trường: Dev (local), Staging (192.168.x.x), Production (server chính). Phân biệt bằng màu status bar: đỏ = non-production, xanh = production.",
    cat: 'config', tags: ['connection-string', 'config', 'environment', 'database']
  },
  {
    q: "Cách quản lý multi-database trong MDS?",
    a: "MDS hỗ trợ SQL Server (chính) và SQLite (offline). LiteSql cung cấp cross-database support qua DbProvider abstraction. Connection string config per database. dbMDSDataContext.New() tạo context mới mỗi lần dùng (transient pattern). Không share context giữa các thread. Config.ConnectionString là entry point chính.",
    cat: 'config', tags: ['multi-database', 'sqlite', 'sqlserver', 'litesql']
  },

  // ======================== DESIGN PATTERNS THỰC TẾ ========================
  {
    q: "Singleton pattern dùng ở đâu trong MDS?",
    a: "clsSecurity (LoginUser, Permission): singleton toàn app. Config: static property cho connection string. MDSEnvironments: singleton cho đường dẫn. ActionLogHelper: static helper. Autofac SingleInstance cho shared services (IQueryQueue, IEventBus). Lưu ý: tránh singleton cho stateful objects (DbContext, Form instance).",
    cat: 'architecture', tags: ['singleton', 'pattern', 'static', 'design']
  },
  {
    q: "Observer pattern (EventBus) dùng khi nào?",
    a: "Khi cần thông báo giữa modules không biết nhau. Ví dụ: Module Sales tạo Order → Publish OrderCreatedEvent → Module Inventory tự động cập nhật tồn kho dự kiến. Module Production thay đổi schedule → Publish ScheduleChangedEvent → Assembly grid tự refresh. Dùng IEventBus, subscribe trong constructor, unsubscribe trong Dispose.",
    cat: 'architecture', tags: ['observer', 'eventbus', 'pattern', 'decouple']
  },
  {
    q: "Repository pattern có dùng trong MDS không?",
    a: "MDS không dùng Repository pattern truyền thống. Thay vào đó dùng: Service layer trực tiếp access DB qua DataContext hoặc DbHelper. Lý do: WinForms app không cần abstraction level cao như WebAPI. Service đã đủ vai trò encapsulate data access. Nếu cần test isolation, mock IService interface thay vì repository.",
    cat: 'architecture', tags: ['repository', 'pattern', 'service', 'design']
  },
];

async function seedQA() {
  const force = process.argv.includes('--force');
  
  if (force) {
    await pool.query('DELETE FROM agent_qa_history');
    await pool.query('DELETE FROM agent_qa_cache');
    console.log('[!] Cleared all existing QA cache + history entries');
  }

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
      process.stdout.write(`\r[+] Processing ${inserted + updated}/${QA_DATA.length} (new: ${inserted}, updated: ${updated})...`);
    } catch (err) {
      console.error(`\n[!] Failed: "${item.q.substring(0,50)}..." - ${err.message}`);
    }
  }

  console.log(`\n\n[DONE] Inserted: ${inserted}, Updated: ${updated}`);

  const stats = await pool.query(`
    SELECT category, COUNT(*) as cnt FROM agent_qa_cache GROUP BY category ORDER BY cnt DESC
  `);
  console.log('\n[STATS BY CATEGORY]');
  stats.rows.forEach(r => console.log(`  ${r.category}: ${r.cnt}`));

  const total = await pool.query('SELECT COUNT(*) as total FROM agent_qa_cache');
  console.log(`  TOTAL: ${total.rows[0].total} entries`);

  await pool.end();
}

seedQA();
