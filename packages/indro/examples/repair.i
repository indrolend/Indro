@repair
!"repair ${target}, prove the change, and retain evidence"
$target:path
$depth:choice(focused|full)=focused
+rwx

:main
  ."repair-start target=${target} depth=${depth}"
  >o
  ||
    >a ${target}
    >d
  >ck
  >p ${target}
  ?"tests pass for ${target}"
  ~
    >a ${target}
    >ck
  ."repair-complete target=${target}"
