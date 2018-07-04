#/bin/bash
cd /output

for classfile in *.class; do
    classname=${classfile%.*}

    # TODO remove redundant greps
    if javap -public $classname | fgrep -q 'public static void main(java.lang.String[])'; then
        java $classname "$@"
        exit 0;
    fi

    if javap -public $classname | fgrep -q 'public static void main(java.lang.String...)'; then
        java $classname "$@"
        exit 0;
    fi
done