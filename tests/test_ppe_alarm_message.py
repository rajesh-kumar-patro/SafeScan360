import unittest
from backend.ppe_workflow import build_missing_ppe_message as msg, summarize_ppe_status as summ


class MessageTests(unittest.TestCase):
    def test_single_items(self):
        self.assertEqual(msg(["helmet"]), "Warning. Helmet is missing.")
        self.assertEqual(msg(["gloves"]), "Warning. Gloves are missing.")
        self.assertEqual(msg(["vest"]), "Warning. Safety vest is missing.")
        self.assertEqual(msg(["shoes"]), "Warning. Safety shoes are missing.")

    def test_multiple_items_fixed_order(self):
        self.assertEqual(msg(["gloves", "helmet"]), "Warning. Helmet and gloves are missing.")
        self.assertEqual(msg(["gloves", "shoes", "helmet"]), "Warning. Helmet, safety shoes and gloves are missing.")
        self.assertEqual(msg(["helmet", "vest", "shoes", "gloves"]),
                         "Warning. Helmet, safety vest, safety shoes and gloves are missing.")

    def test_nothing_missing_and_unknown(self):
        self.assertEqual(msg([]), "")
        self.assertEqual(msg(["goggles"]), "")


def worker(missing=(), lost=False, checking=False):
    return {"missing": list(missing), "lost": lost, "checking": checking}


class StatusTests(unittest.TestCase):
    def test_no_worker(self):
        s = summ([])
        self.assertEqual((s["status"], s["announcement"], s["detected"]), ("NO_WORKER", "", []))

    def test_all_detected(self):
        s = summ([worker()])
        self.assertEqual(s["status"], "ALL_PPE_DETECTED")
        self.assertEqual(s["announcement"], "")
        self.assertEqual(s["detected"], ["helmet", "vest", "shoes", "gloves"])

    def test_missing_and_detected(self):
        s = summ([worker(["gloves", "helmet"])])
        self.assertEqual(s["status"], "PPE_MISSING")
        self.assertEqual(s["missing"], ["helmet", "gloves"])
        self.assertEqual(s["detected"], ["vest", "shoes"])
        self.assertEqual(s["announcement"], "Warning. Helmet and gloves are missing.")
        self.assertEqual(s["signature"], "helmet|gloves")

    def test_union_over_workers_and_lost_ignored(self):
        s = summ([worker(["helmet"]), worker(["gloves"]), worker(["vest"], lost=True)])
        self.assertEqual(s["missing"], ["helmet", "gloves"])

    def test_checking_is_not_reported_as_safe(self):
        self.assertEqual(summ([worker(checking=True)])["status"], "CHECKING")
        self.assertEqual(summ([worker(["helmet"], checking=True)])["status"], "PPE_MISSING")


if __name__ == "__main__":
    unittest.main()
