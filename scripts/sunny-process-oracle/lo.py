"""LibreOffice UNO 会话：打开 Excel 原件、写输入格、全量重算、读输出格。

只用于离线生成金标准夹具；CI 不依赖。需要系统装有 LibreOffice（soffice）与 python3-uno。
"""
import os
import subprocess
import time

import uno  # type: ignore
from com.sun.star.beans import PropertyValue  # type: ignore

CELL_EMPTY, CELL_VALUE, CELL_TEXT, CELL_FORMULA = "EMPTY", "VALUE", "TEXT", "FORMULA"
FORMULA_RESULT_VALUE = 1


def _prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


class Session:
    def __init__(self, port=2002):
        self.port = port
        self.proc = subprocess.Popen(
            [
                "soffice", "--headless", "--invisible", "--norestore", "--nologo",
                f"--accept=socket,host=localhost,port={port};urp;",
                f"-env:UserInstallation=file:///tmp/sunny_oracle_lo_{port}",
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext(
            "com.sun.star.bridge.UnoUrlResolver", local)
        last = None
        for _ in range(120):
            try:
                self.ctx = resolver.resolve(
                    f"uno:socket,host=localhost,port={port};urp;StarOffice.ComponentContext")
                break
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(0.5)
        else:
            raise RuntimeError(f"cannot connect to soffice: {last}")
        self.desktop = self.ctx.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", self.ctx)

    def open(self, path):
        url = uno.systemPathToFileUrl(os.path.abspath(path))
        return Workbook(self.desktop.loadComponentFromURL(url, "_blank", 0, (_prop("Hidden", True),)))

    def close(self):
        try:
            self.desktop.terminate()
        except Exception:  # noqa: BLE001
            pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except Exception:  # noqa: BLE001
            self.proc.kill()


class Workbook:
    def __init__(self, doc):
        self.doc = doc

    def sheet(self, name):
        return self.doc.Sheets.getByName(name)

    def set(self, sheet, cell, value):
        c = self.sheet(sheet).getCellRangeByName(cell)
        if value is None or value == "":
            c.setString("")
        elif isinstance(value, bool):
            raise TypeError("bool input not supported")
        elif isinstance(value, (int, float)):
            c.setValue(value)
        else:
            c.setString(str(value))

    def set_formula(self, sheet, cell, formula):
        # XCell.setFormula 走 API 语法：英文函数名、分号分隔
        self.sheet(sheet).getCellRangeByName(cell).setFormula(formula.replace(",", ";"))

    def is_formula(self, sheet, cell):
        return self.sheet(sheet).getCellRangeByName(cell).Type.value == CELL_FORMULA

    def clear(self, sheet, rng):
        # VALUE(1)|DATETIME(2)|STRING(4)：只清常量，保留公式
        self.sheet(sheet).getCellRangeByName(rng).clearContents(1 | 2 | 4)

    def recalc(self):
        self.doc.calculateAll()

    def get(self, sheet, cell):
        c = self.sheet(sheet).getCellRangeByName(cell)
        return read_cell(c)

    def get_range(self, sheet, rng):
        """返回 {A1: value}，跳过空值。"""
        sh = self.sheet(sheet)
        r = sh.getCellRangeByName(rng)
        a = r.getRangeAddress()
        out = {}
        for row in range(a.StartRow, a.EndRow + 1):
            for col in range(a.StartColumn, a.EndColumn + 1):
                c = sh.getCellByPosition(col, row)
                v = read_cell(c)
                if v is None or v == "":
                    continue
                out[c.AbsoluteName.split(".")[-1].replace("$", "")] = v
        return out

    def close(self):
        self.doc.close(True)


def read_cell(c):
    t = c.Type.value
    if t == CELL_EMPTY:
        return None
    if t == CELL_VALUE:
        return c.getValue()
    if t == CELL_TEXT:
        return raw_text(c)
    err = c.getError()
    if err:
        return {"error": c.getString() or f"Err:{err}"}
    if c.FormulaResultType2 == FORMULA_RESULT_VALUE:
        return c.getValue()
    return raw_text(c)


def raw_text(c):
    """文本结果取原始值：getString() 会带上单元格数字格式（如会计格式 _-@_- 两侧补空格）。"""
    v = c.getDataArray()[0][0]
    return v if isinstance(v, str) else c.getString()
