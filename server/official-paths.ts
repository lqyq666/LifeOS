// Public reference destinations, not admissions/job/recognition guarantees.
export const officialPaths=[
  {key:'recommendation',title:'推免与免初试',url:'https://yz.chsi.com.cn/tm/',publisher:'中国研究生招生信息网',purpose:'核对本人推免资格、本校推荐办法和招生单位接收安排',limitations:['志愿填报、复试通知确认、待录取确认是不同动作，须分别核截止','全国服务系统开放不证明你已获得推免资格；本校和招生单位可能有更早安排']},
  {key:'employment',title:'就业与实习',url:'https://www.ncss.cn/',publisher:'国家大学生就业服务平台',purpose:'查找真实岗位，再核雇主、工作内容、届别、地域、薪酬和截止',limitations:['平台入口或网页空壳不证明某岗位存在、仍可投或雇主已核实','没有具体岗位与批次证据时，岗位要求和可投状态保持未知']},
  {key:'overseas',title:'留学与学历认证',url:'https://portal.cscse.edu.cn/lxfwzx/xlxwrz/rzyxcxmd/index.html',publisher:'中国留学网',purpose:'区分院校历史认证查询、具体项目录取要求和个人学历认证条件',limitations:['历史认证院校名单仅供择校参考，不保证项目录取或个人认证','校区、项目、学习方式、申请年度、资金和语言条件须另核；不自动访问HTTP子站']},
] as const
